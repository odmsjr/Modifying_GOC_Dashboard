// backend/src/controllers/centreonController.js
const centreonAxios = require("../config/axiosCentreon");
const db = require("../config/db");

// ============================================================
// IN-MEMORY CACHE
// ============================================================

let pollerHostCountCache = {
    data: {},
    hostsByPoller: {},
    updatedAt: null,
    isRefreshing: false
};

const POLLER_HOST_COUNT_CACHE_TTL_MS = 5 * 60 * 1000;

let dashboardGlobalSummaryCache = {
    counts: {
        allActiveIssues: null,
        critical: null,
        warning: null,
        unknown: null
    },
    services: {
        critical: [],
        warning: [],
        unknown: []
    },
    updatedAt: null,
    isRefreshing: false,
    lastError: null
};

const DASHBOARD_GLOBAL_SUMMARY_CACHE_TTL_MS = 5 * 60 * 1000;

// ============================================================
// HELPERS
// ============================================================

const getCentreonHeaders = (req) => {
    const authHeader = req.headers.authorization;

    const tokenFromFrontend = authHeader?.startsWith("Bearer ")
        ? authHeader.replace("Bearer ", "")
        : authHeader;

    const activeToken = tokenFromFrontend || process.env.CENTREON_API_TOKEN;

    return {
        "X-AUTH-TOKEN": activeToken,
        "Content-Type": "application/json"
    };
};

const handleCentreonError = (error, res, next) => {
    console.error("Centreon API Error:", {
        status: error.response?.status,
        data: error.response?.data,
        message: error.message,
        code: error.code
    });

    if (error.response?.status === 401) {
        return res.status(401).json({
            success: false,
            message: "Centreon session invalid or expired."
        });
    }

    if (error.response?.status === 403) {
        return res.status(403).json({
            success: false,
            message: "Centreon refused access. Token may be valid, but user may not have API/realtime permissions."
        });
    }

    return next(error);
};

const getStatusNameFromCode = (statusCode) => {
    switch (Number(statusCode)) {
        case 0:
            return "OK";
        case 1:
            return "WARNING";
        case 2:
            return "CRITICAL";
        case 3:
            return "UNKNOWN";
        default:
            return "UNKNOWN";
    }
};

const normalizeService = (service) => {
    const statusCode = Number(service.status?.code ?? service.state);

    const statusName = String(
        service.status?.name || getStatusNameFromCode(statusCode)
    ).toUpperCase();

    return {
        ...service,
        statusCode,
        statusName,
        poller_name:
            service.poller_name ||
            service.host?.poller_name ||
            (service.host?.poller_id ? `Poller ${service.host.poller_id}` : "Default Poller")
    };
};

const buildServicesEndpoint = ({ page = 1, limit = 100, search = null }) => {
    const params = new URLSearchParams({
        page: String(page),
        limit: String(limit)
    });

    if (search) {
        params.set("search", JSON.stringify(search));
    }

    return `/monitoring/services?${params.toString()}`;
};

const deriveServerType = (server) => {
    const rawType =
        server.server_type ||
        server.type ||
        server.type_name ||
        server.serverType ||
        "";

    if (rawType) {
        return rawType;
    }

    const name = String(
        server.name ||
        server.poller_name ||
        server.server_name ||
        server.instance_name ||
        ""
    ).toLowerCase();

    if (name === "central" || name.includes("central")) {
        return "Central";
    }

    if (name.includes("remote")) {
        return "Remote";
    }

    if (name.includes("poller")) {
        return "Poller";
    }

    return "N/A";
};

const getRequestUserName = (req) => {
    return (
        req.body?.action_by ||
        req.body?.actionBy ||
        req.headers["x-user-name"] ||
        "Dashboard User"
    );
};

const getOrCreateAuditServerId = async (hostName) => {
    const safeHostName = hostName || "Unknown Host";

    const [existingRows] = await db.execute(
        `SELECT id FROM servers WHERE hostname = ? LIMIT 1`,
        [safeHostName]
    );

    if (existingRows.length > 0) {
        return existingRows[0].id;
    }

    const [insertResult] = await db.execute(
        `INSERT INTO servers (hostname) VALUES (?)`,
        [safeHostName]
    );

    return insertResult.insertId;
};

const writeAuditLog = async ({
    host,
    service,
    logType,
    oldStatus,
    newStatus,
    actionBy,
    message
}) => {
    const serverId = await getOrCreateAuditServerId(host);

    const query = `
        INSERT INTO server_activity_log
        (server_id, incident_id, log_type, old_status, new_status, action_by, message)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `;

    await db.execute(query, [
        serverId,
        service || null,
        logType,
        oldStatus || null,
        newStatus || null,
        actionBy || "Dashboard User",
        message || null
    ]);
};

/**
 * Gets real Centreon poller / monitoring server names.
 * This maps:
 * poller_id -> { name, address, server_type }
 */
const getMonitoringServerMap = async (req) => {
    try {
        const serverMap = {};

        const limit = 1000;
        let page = 1;
        let counted = 0;
        let totalFromCentreon = 0;

        while (true) {
            const params = new URLSearchParams({
                page: String(page),
                limit: String(limit)
            });

            const endpoint = `/configuration/monitoring-servers?${params.toString()}`;

            console.log("Centreon getMonitoringServerMap URL:", endpoint);

            const response = await centreonAxios.get(endpoint, {
                headers: getCentreonHeaders(req)
            });

            const servers =
                response.data?.result ||
                response.data?.data?.result ||
                response.data?.items ||
                response.data?.data ||
                [];

            totalFromCentreon =
                response.data?.meta?.total ||
                response.data?.data?.meta?.total ||
                servers.length;

            servers.forEach((server) => {
                const id =
                    server.id ??
                    server.poller_id ??
                    server.monitoring_server_id ??
                    server.server_id;

                const name =
                    server.name ??
                    server.poller_name ??
                    server.server_name ??
                    server.instance_name;

                if (id !== undefined && id !== null) {
                    serverMap[String(id)] = {
                        id,
                        name: name || `Poller ${id}`,
                        address:
                            server.address ||
                            server.address_ip ||
                            server.ip ||
                            server.ip_address ||
                            "",
                        server_type: deriveServerType(server)
                    };
                }
            });

            counted += servers.length;

            if (counted >= totalFromCentreon || servers.length === 0) {
                break;
            }

            page += 1;
        }

        console.log("Monitoring server map:", serverMap);

        return serverMap;

    } catch (error) {
        console.warn("Unable to fetch Centreon monitoring servers. Falling back to Poller ID names.", {
            status: error.response?.status,
            data: error.response?.data,
            message: error.message
        });

        return {};
    }
};

const refreshPollerHostCountCache = async (req, monitoringServerMap) => {
    if (pollerHostCountCache.isRefreshing) {
        return;
    }

    pollerHostCountCache.isRefreshing = true;

    try {
        const countMap = {};
        const hostsByPoller = {};

        Object.values(monitoringServerMap).forEach((server) => {
            const pollerId = String(server.id);

            countMap[pollerId] = {
                totalHosts: 0,
                upHosts: 0,
                downHosts: 0,
                unreachableHosts: 0,
                pendingHosts: 0
            };

            hostsByPoller[pollerId] = [];
        });

        const limit = 1000;
        let page = 1;
        let counted = 0;
        let totalFromCentreon = 0;

        while (true) {
            const params = new URLSearchParams({
                page: String(page),
                limit: String(limit)
            });

            const endpoint = `/monitoring/hosts?${params.toString()}`;

            console.log("Centreon background poller host count URL:", endpoint);

            const response = await centreonAxios.get(endpoint, {
                headers: getCentreonHeaders(req)
            });

            const hosts = response.data?.result || [];

            totalFromCentreon =
                response.data?.meta?.total ||
                hosts.length;

            hosts.forEach((host) => {
                const pollerId = String(host.poller_id ?? "unknown");
                const mappedServer = monitoringServerMap[pollerId];

                if (!countMap[pollerId]) {
                    countMap[pollerId] = {
                        totalHosts: 0,
                        upHosts: 0,
                        downHosts: 0,
                        unreachableHosts: 0,
                        pendingHosts: 0
                    };
                }

                if (!hostsByPoller[pollerId]) {
                    hostsByPoller[pollerId] = [];
                }

                const normalizedHost = {
                    ...host,
                    poller_name:
                        host.poller_name ||
                        mappedServer?.name ||
                        (host.poller_id ? `Poller ${host.poller_id}` : "Default Poller"),
                    poller_address: mappedServer?.address || "",
                    poller_server_type: mappedServer?.server_type || ""
                };

                hostsByPoller[pollerId].push(normalizedHost);

                countMap[pollerId].totalHosts += 1;

                const state = Number(host.state);

                if (state === 0) {
                    countMap[pollerId].upHosts += 1;
                } else if (state === 1) {
                    countMap[pollerId].downHosts += 1;
                } else if (state === 2) {
                    countMap[pollerId].unreachableHosts += 1;
                } else if (state === 3) {
                    countMap[pollerId].pendingHosts += 1;
                }
            });

            counted += hosts.length;

            if (counted >= totalFromCentreon || hosts.length === 0) {
                break;
            }

            page += 1;
        }

        pollerHostCountCache = {
            data: countMap,
            hostsByPoller,
            updatedAt: Date.now(),
            isRefreshing: false
        };

        console.log("Poller host count/cache refreshed:", {
            totalPollers: Object.keys(countMap).length,
            totalHosts: counted
        });

    } catch (error) {
        console.error("Failed refreshing poller host count cache:", {
            status: error.response?.status,
            data: error.response?.data,
            message: error.message
        });

        pollerHostCountCache.isRefreshing = false;
    }
};

const refreshDashboardGlobalSummaryCache = async (req) => {
    if (dashboardGlobalSummaryCache.isRefreshing) {
        return;
    }

    dashboardGlobalSummaryCache.isRefreshing = true;

    try {
        const limit = 1000;
        let page = 1;
        let counted = 0;
        let totalFromCentreon = 0;

        const criticalServices = [];
        const warningServices = [];
        const unknownServices = [];

        while (true) {
            const endpoint = buildServicesEndpoint({
                page,
                limit
            });

            console.log("Centreon dashboard global summary cache URL:", endpoint);

            const response = await centreonAxios.get(endpoint, {
                headers: getCentreonHeaders(req)
            });

            const services = response.data?.result || [];
            const normalizedServices = services.map(normalizeService);

            normalizedServices.forEach((service) => {
                if (service.statusCode === 2) {
                    criticalServices.push(service);
                } else if (service.statusCode === 1) {
                    warningServices.push(service);
                } else if (service.statusCode === 3) {
                    unknownServices.push(service);
                }
            });

            totalFromCentreon =
                response.data?.meta?.total ||
                services.length;

            counted += services.length;

            if (counted >= totalFromCentreon || services.length === 0) {
                break;
            }

            page += 1;
        }

        const allActiveIssues =
            criticalServices.length +
            warningServices.length +
            unknownServices.length;

        dashboardGlobalSummaryCache = {
            counts: {
                allActiveIssues,
                critical: criticalServices.length,
                warning: warningServices.length,
                unknown: unknownServices.length
            },
            services: {
                critical: criticalServices,
                warning: warningServices,
                unknown: unknownServices
            },
            updatedAt: Date.now(),
            isRefreshing: false,
            lastError: null
        };

        console.log("Dashboard global summary cache refreshed:", {
            totalServicesScanned: counted,
            allActiveIssues,
            critical: criticalServices.length,
            warning: warningServices.length,
            unknown: unknownServices.length
        });

    } catch (error) {
        console.error("Failed refreshing dashboard global summary cache:", {
            status: error.response?.status,
            data: error.response?.data,
            message: error.message
        });

        dashboardGlobalSummaryCache = {
            ...dashboardGlobalSummaryCache,
            isRefreshing: false,
            lastError: {
                status: error.response?.status,
                data: error.response?.data,
                message: error.message
            }
        };
    }
};

// Temporary debug endpoint to verify Centreon monitoring servers output.
const testMonitoringServers = async (req, res, next) => {
    try {
        const limit = Number(req.query.limit) || 1000;
        let page = 1;
        let counted = 0;
        let totalFromCentreon = 0;

        const allServers = [];

        while (true) {
            const params = new URLSearchParams({
                page: String(page),
                limit: String(limit)
            });

            const endpoint = `/configuration/monitoring-servers?${params.toString()}`;

            console.log("Centreon testMonitoringServers URL:", endpoint);

            const response = await centreonAxios.get(endpoint, {
                headers: getCentreonHeaders(req)
            });

            const servers =
                response.data?.result ||
                response.data?.data?.result ||
                response.data?.items ||
                response.data?.data ||
                [];

            totalFromCentreon =
                response.data?.meta?.total ||
                response.data?.data?.meta?.total ||
                servers.length;

            allServers.push(...servers);

            counted += servers.length;

            if (counted >= totalFromCentreon || servers.length === 0) {
                break;
            }

            page += 1;
        }

        return res.json({
            success: true,
            count: allServers.length,
            data: {
                result: allServers
            },
            meta: {
                total: allServers.length
            }
        });

    } catch (error) {
        return handleCentreonError(error, res, next);
    }
};

// ============================================================
// HOST ENDPOINTS
// ============================================================

const getAllHosts = async (req, res, next) => {
    try {
        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 100;

        const params = new URLSearchParams({
            page: String(page),
            limit: String(limit)
        });

        const endpoint = `/monitoring/hosts?${params.toString()}`;

        console.log("Centreon getAllHosts URL:", endpoint);

        const response = await centreonAxios.get(endpoint, {
            headers: getCentreonHeaders(req)
        });

        return res.json({
            success: true,
            count: response.data?.result?.length || 0,
            data: response.data,
            meta: response.data?.meta || {
                page,
                limit,
                total: response.data?.result?.length || 0
            }
        });
    } catch (error) {
        return handleCentreonError(error, res, next);
    }
};

const getHostById = async (req, res, next) => {
    try {
        const { id } = req.params;
        const endpoint = `/monitoring/hosts/${id}`;

        console.log("Centreon getHostById URL:", endpoint);

        const response = await centreonAxios.get(endpoint, {
            headers: getCentreonHeaders(req)
        });

        return res.json({
            success: true,
            data: response.data
        });
    } catch (error) {
        return handleCentreonError(error, res, next);
    }
};

const getHostStatus = async (req, res, next) => {
    try {
        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 100;

        const params = new URLSearchParams({
            page: String(page),
            limit: String(limit)
        });

        const endpoint = `/monitoring/hosts?${params.toString()}`;

        console.log("Centreon getHostStatus URL:", endpoint);

        const response = await centreonAxios.get(endpoint, {
            headers: getCentreonHeaders(req)
        });

        return res.json({
            success: true,
            data: response.data
        });
    } catch (error) {
        return handleCentreonError(error, res, next);
    }
};

// ============================================================
// POLLER ENDPOINTS
// ============================================================

const getAllPollers = async (req, res, next) => {
    try {
        const monitoringServerMap = await getMonitoringServerMap(req);

        const now = Date.now();

        const hasFreshCache =
            pollerHostCountCache.updatedAt &&
            now - pollerHostCountCache.updatedAt < POLLER_HOST_COUNT_CACHE_TTL_MS;

        if (!hasFreshCache && !pollerHostCountCache.isRefreshing) {
            refreshPollerHostCountCache(req, monitoringServerMap);
        }

        const pollers = Object.values(monitoringServerMap)
            .map((server) => {
                const pollerId = String(server.id);
                const cachedCounts = pollerHostCountCache.data[pollerId];

                return {
                    poller_id: server.id,
                    poller_name: server.name || `Poller ${server.id}`,
                    address: server.address || "",
                    server_type: server.server_type || "",
                    totalHosts: cachedCounts?.totalHosts ?? null,
                    upHosts: cachedCounts?.upHosts ?? null,
                    downHosts: cachedCounts?.downHosts ?? null,
                    unreachableHosts: cachedCounts?.unreachableHosts ?? null,
                    pendingHosts: cachedCounts?.pendingHosts ?? null
                };
            })
            .sort((a, b) => {
                const nameA = String(a.poller_name || "").toLowerCase();
                const nameB = String(b.poller_name || "").toLowerCase();
                return nameA.localeCompare(nameB);
            });

        return res.json({
            success: true,
            count: pollers.length,
            data: {
                result: pollers
            },
            meta: {
                totalPollers: pollers.length,
                hostCountLoaded: Boolean(hasFreshCache),
                hostCountRefreshing: pollerHostCountCache.isRefreshing,
                hostCountUpdatedAt: pollerHostCountCache.updatedAt,
                note: hasFreshCache
                    ? "Poller list loaded from cached host counts."
                    : "Poller list loaded immediately. Host counts are refreshing in the background."
            }
        });

    } catch (error) {
        return handleCentreonError(error, res, next);
    }
};

const getPollerHosts = async (req, res, next) => {
    try {
        const { pollerId } = req.params;

        const monitoringServerMap = await getMonitoringServerMap(req);
        const mappedServer = monitoringServerMap[String(pollerId)];

        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 20;

        const now = Date.now();

        const hasAnyCache =
            pollerHostCountCache.updatedAt &&
            pollerHostCountCache.hostsByPoller;

        const hasFreshCache =
            pollerHostCountCache.updatedAt &&
            now - pollerHostCountCache.updatedAt < POLLER_HOST_COUNT_CACHE_TTL_MS;

        // If cache is missing or stale, refresh in the background.
        if (!hasFreshCache && !pollerHostCountCache.isRefreshing) {
            refreshPollerHostCountCache(req, monitoringServerMap);
        }

        const allHostsForPoller =
            pollerHostCountCache.hostsByPoller?.[String(pollerId)] || [];

        // If no cache exists yet, return fast instead of scanning all hosts.
        if (!hasAnyCache) {
            return res.json({
                success: true,
                poller_id: pollerId,
                poller_name: mappedServer?.name || `Poller ${pollerId}`,
                poller_address: mappedServer?.address || "",
                poller_server_type: mappedServer?.server_type || "",
                count: 0,
                data: {
                    result: []
                },
                meta: {
                    page,
                    limit,
                    total: 0,
                    totalPages: 1,
                    hostCacheLoaded: false,
                    hostCacheRefreshing: pollerHostCountCache.isRefreshing,
                    note: "Host cache is not ready yet. Returning immediately while cache refreshes in the background."
                }
            });
        }

        const startIndex = (page - 1) * limit;
        const pagedHosts = allHostsForPoller.slice(startIndex, startIndex + limit);

        return res.json({
            success: true,
            poller_id: pollerId,
            poller_name: mappedServer?.name || `Poller ${pollerId}`,
            poller_address: mappedServer?.address || "",
            poller_server_type: mappedServer?.server_type || "",
            count: pagedHosts.length,
            data: {
                result: pagedHosts
            },
            meta: {
                page,
                limit,
                total: allHostsForPoller.length,
                totalPages: Math.max(1, Math.ceil(allHostsForPoller.length / limit)),
                hostCacheLoaded: true,
                hostCacheFresh: Boolean(hasFreshCache),
                hostCacheRefreshing: pollerHostCountCache.isRefreshing,
                hostCacheUpdatedAt: pollerHostCountCache.updatedAt,
                note: hasFreshCache
                    ? "Hosts loaded from fresh poller host cache."
                    : "Hosts loaded from stale poller host cache while refresh runs in the background."
            }
        });

    } catch (error) {
        return handleCentreonError(error, res, next);
    }
};

/**
 * Fast-only selected poller service summary.
 *
 * IMPORTANT:
 * This does NOT scan all services.
 */
const getPollerServiceSummary = async (req, res, next) => {
    try {
        const { pollerId } = req.params;

        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 100;

        const monitoringServerMap = await getMonitoringServerMap(req);
        const mappedServer = monitoringServerMap[String(pollerId)];

        return res.json({
            success: true,
            poller_id: pollerId,
            poller_name: mappedServer?.name || `Poller ${pollerId}`,
            poller_address: mappedServer?.address || "",
            poller_server_type: mappedServer?.server_type || "",
            mode: "fast-no-scan",
            counts: {
                allServices: null,
                critical: null,
                warning: null,
                unknown: null
            },
            services: {
                critical: [],
                warning: [],
                unknown: []
            },
            data: {
                result: []
            },
            meta: {
                page,
                limit,
                total: 0,
                totalPages: 1
            },
            note: "Fast mode only. Full service scan is disabled to keep Pollers page responsive."
        });

    } catch (error) {
        return handleCentreonError(error, res, next);
    }
};

// ============================================================
// SERVICE ENDPOINTS
// ============================================================

const getAllServices = async (req, res, next) => {
    try {
        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 100;

        const endpoint = buildServicesEndpoint({ page, limit });

        console.log("Centreon getAllServices URL:", endpoint);

        const response = await centreonAxios.get(endpoint, {
            headers: getCentreonHeaders(req)
        });

        const services = response.data?.result || [];
        const normalizedServices = services.map(normalizeService);

        return res.json({
            success: true,
            count: normalizedServices.length,
            data: {
                ...response.data,
                result: normalizedServices
            },
            meta: response.data?.meta || {
                page,
                limit,
                total: normalizedServices.length
            }
        });
    } catch (error) {
        return handleCentreonError(error, res, next);
    }
};

const searchServicesGlobally = async (req, res, next) => {
    try {
        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 100;

        const q = String(req.query.q || "").trim();
        const host = String(req.query.host || "").trim();
        const service = String(req.query.service || "").trim();

        if (!q && !host && !service) {
            return res.status(400).json({
                success: false,
                message: "Please provide q, host, or service query parameter."
            });
        }

        const mergedMap = new Map();
        const attemptResults = [];

        const runSearchAttempt = async (label, searchObject) => {
            try {
                const endpoint = buildServicesEndpoint({
                    page,
                    limit,
                    search: searchObject
                });

                console.log(`Centreon global service search [${label}]:`, endpoint);

                const response = await centreonAxios.get(endpoint, {
                    headers: getCentreonHeaders(req)
                });

                const services = response.data?.result || [];
                const normalizedServices = services.map(normalizeService);

                normalizedServices.forEach((serviceItem) => {
                    const key = serviceItem.id || `${serviceItem.host?.name}-${serviceItem.description}`;
                    mergedMap.set(key, serviceItem);
                });

                attemptResults.push({
                    label,
                    success: true,
                    count: normalizedServices.length,
                    total: response.data?.meta?.total ?? normalizedServices.length
                });

            } catch (error) {
                console.warn(`Centreon search attempt failed [${label}]`, {
                    status: error.response?.status,
                    data: error.response?.data,
                    message: error.message
                });

                attemptResults.push({
                    label,
                    success: false,
                    status: error.response?.status,
                    data: error.response?.data,
                    message: error.message
                });
            }
        };

        if (q || host) {
            const hostTerm = host || q;

            await runSearchAttempt("host.name", {
                "host.name": hostTerm
            });

            await runSearchAttempt("host.alias", {
                "host.alias": hostTerm
            });
        }

        if (q || service) {
            const serviceTerm = service || q;

            await runSearchAttempt("service.description", {
                "service.description": serviceTerm
            });
        }

        let results = Array.from(mergedMap.values());

        if (host) {
            const hostLower = host.toLowerCase();

            results = results.filter(item => {
                const hostName = item.host?.name?.toLowerCase() || "";
                const hostAlias = item.host?.alias?.toLowerCase() || "";
                const hostDisplayName = item.host?.display_name?.toLowerCase() || "";

                return (
                    hostName.includes(hostLower) ||
                    hostAlias.includes(hostLower) ||
                    hostDisplayName.includes(hostLower)
                );
            });
        }

        if (service) {
            const serviceLower = service.toLowerCase();

            results = results.filter(item => {
                const description = item.description?.toLowerCase() || "";
                const displayName = item.display_name?.toLowerCase() || "";

                return (
                    description.includes(serviceLower) ||
                    displayName.includes(serviceLower)
                );
            });
        }

        const criticalServices = results.filter(item => item.statusCode === 2);
        const warningServices = results.filter(item => item.statusCode === 1);
        const unknownServices = results.filter(item => item.statusCode === 3);

        return res.json({
            success: true,
            query: {
                q,
                host,
                service,
                page,
                limit
            },
            count: results.length,
            counts: {
                allActiveIssues: criticalServices.length + warningServices.length + unknownServices.length,
                critical: criticalServices.length,
                warning: warningServices.length,
                unknown: unknownServices.length
            },
            data: {
                result: results
            },
            services: {
                critical: criticalServices,
                warning: warningServices,
                unknown: unknownServices
            },
            debug: {
                attempts: attemptResults
            },
            note: "Global search supports confirmed host fields and confirmed service.description field."
        });

    } catch (error) {
        return handleCentreonError(error, res, next);
    }
};

const getServicesByHost = async (req, res, next) => {
    try {
        const { hostId } = req.params;

        const endpoint = buildServicesEndpoint({
            page: 1,
            limit: 100,
            search: {
                "host.id": Number(hostId)
            }
        });

        console.log("Centreon getServicesByHost URL:", endpoint);

        const response = await centreonAxios.get(endpoint, {
            headers: getCentreonHeaders(req)
        });

        const services = response.data?.result || [];
        const normalizedServices = services.map(normalizeService);

        return res.json({
            success: true,
            count: normalizedServices.length,
            data: {
                ...response.data,
                result: normalizedServices
            }
        });
    } catch (error) {
        return handleCentreonError(error, res, next);
    }
};

// ============================================================
// PAGE-BASED STATUS SUMMARY
// ============================================================

const getServiceStatusSummary = async (req, res, next) => {
    try {
        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 100;

        const endpoint = buildServicesEndpoint({ page, limit });

        console.log("Centreon getServiceStatusSummary URL:", endpoint);

        const response = await centreonAxios.get(endpoint, {
            headers: getCentreonHeaders(req)
        });

        const services = response.data?.result || [];
        const normalizedServices = services.map(normalizeService);

        const criticalServices = normalizedServices.filter(service => service.statusCode === 2);
        const warningServices = normalizedServices.filter(service => service.statusCode === 1);
        const unknownServices = normalizedServices.filter(service => service.statusCode === 3);
        const okServices = normalizedServices.filter(service => service.statusCode === 0);

        const allProblemServices =
            criticalServices.length +
            warningServices.length +
            unknownServices.length;

        return res.json({
            success: true,
            counts: {
                ok: okServices.length,
                critical: criticalServices.length,
                warning: warningServices.length,
                unknown: unknownServices.length,
                allServices: allProblemServices,
                totalPageServices: normalizedServices.length
            },
            services: {
                critical: criticalServices,
                warning: warningServices,
                unknown: unknownServices
            },
            data: {
                ...response.data,
                result: normalizedServices
            },
            meta: response.data?.meta || {
                page,
                limit,
                total: normalizedServices.length
            },
            note: "Page-based summary only. All Services means Critical + Warning + Unknown."
        });
    } catch (error) {
        return handleCentreonError(error, res, next);
    }
};

const getGlobalServiceStatusSummary = async (req, res, next) => {
    try {
        const now = Date.now();

        const hasCachedCounts =
            dashboardGlobalSummaryCache.updatedAt &&
            dashboardGlobalSummaryCache.counts.allActiveIssues !== null;

        const hasFreshCache =
            dashboardGlobalSummaryCache.updatedAt &&
            now - dashboardGlobalSummaryCache.updatedAt < DASHBOARD_GLOBAL_SUMMARY_CACHE_TTL_MS;

        if (!hasFreshCache && !dashboardGlobalSummaryCache.isRefreshing) {
            refreshDashboardGlobalSummaryCache(req);
        }

        return res.json({
            success: true,
            cached: Boolean(hasCachedCounts),
            refreshing: dashboardGlobalSummaryCache.isRefreshing,
            counts: dashboardGlobalSummaryCache.counts,
            services: dashboardGlobalSummaryCache.services,
            meta: {
                cacheLoaded: Boolean(hasCachedCounts),
                cacheFresh: Boolean(hasFreshCache),
                cacheRefreshing: dashboardGlobalSummaryCache.isRefreshing,
                cacheUpdatedAt: dashboardGlobalSummaryCache.updatedAt,
                cacheTtlMs: DASHBOARD_GLOBAL_SUMMARY_CACHE_TTL_MS,
                lastError: dashboardGlobalSummaryCache.lastError
            },
            note: hasCachedCounts
                ? "Global dashboard summary returned from cache. Cache refreshes in the background when stale."
                : "Global dashboard summary cache is not ready yet. Refresh has started in the background."
        });

    } catch (error) {
        return handleCentreonError(error, res, next);
    }
};

const getGlobalServiceStatusSummaryList = async (req, res, next) => {
    try {
        const type = String(req.query.type || "all").toLowerCase();
        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 100;

        const now = Date.now();

        const hasCachedCounts =
            dashboardGlobalSummaryCache.updatedAt &&
            dashboardGlobalSummaryCache.counts.allActiveIssues !== null;

        const hasFreshCache =
            dashboardGlobalSummaryCache.updatedAt &&
            now - dashboardGlobalSummaryCache.updatedAt < DASHBOARD_GLOBAL_SUMMARY_CACHE_TTL_MS;

        // Start/refresh cache in the background if missing or stale.
        if (!hasFreshCache && !dashboardGlobalSummaryCache.isRefreshing) {
            refreshDashboardGlobalSummaryCache(req);
        }

        if (!hasCachedCounts) {
            return res.json({
                success: true,
                cached: false,
                refreshing: dashboardGlobalSummaryCache.isRefreshing,
                type,
                counts: dashboardGlobalSummaryCache.counts,
                data: {
                    result: []
                },
                meta: {
                    page,
                    limit,
                    total: 0,
                    totalPages: 1,
                    cacheLoaded: false,
                    cacheFresh: false,
                    cacheRefreshing: dashboardGlobalSummaryCache.isRefreshing,
                    cacheUpdatedAt: dashboardGlobalSummaryCache.updatedAt,
                    note: "Global summary cache is not ready yet. Refresh has started in the background."
                }
            });
        }

        const criticalServices = dashboardGlobalSummaryCache.services.critical || [];
        const warningServices = dashboardGlobalSummaryCache.services.warning || [];
        const unknownServices = dashboardGlobalSummaryCache.services.unknown || [];

        let selectedServices = [];

        if (type === "critical") {
            selectedServices = criticalServices;
        } else if (type === "warning") {
            selectedServices = warningServices;
        } else if (type === "unknown") {
            selectedServices = unknownServices;
        } else {
            selectedServices = [
                ...criticalServices,
                ...warningServices,
                ...unknownServices
            ];
        }

        const startIndex = (page - 1) * limit;
        const pagedServices = selectedServices.slice(startIndex, startIndex + limit);

        return res.json({
            success: true,
            cached: true,
            refreshing: dashboardGlobalSummaryCache.isRefreshing,
            type,
            counts: dashboardGlobalSummaryCache.counts,
            data: {
                result: pagedServices
            },
            meta: {
                page,
                limit,
                total: selectedServices.length,
                totalPages: Math.max(1, Math.ceil(selectedServices.length / limit)),
                cacheLoaded: true,
                cacheFresh: Boolean(hasFreshCache),
                cacheRefreshing: dashboardGlobalSummaryCache.isRefreshing,
                cacheUpdatedAt: dashboardGlobalSummaryCache.updatedAt,
                cacheTtlMs: DASHBOARD_GLOBAL_SUMMARY_CACHE_TTL_MS,
                note: hasFreshCache
                    ? "Global summary list returned from fresh cache."
                    : "Global summary list returned from stale cache while refresh runs in the background."
            }
        });

    } catch (error) {
        return handleCentreonError(error, res, next);
    }
};

const resolveServiceResourceIds = async (req, targetHost, targetService) => {
    // If frontend already sends IDs, no need to resolve.
    if (
        req.body.hostId !== undefined &&
        req.body.hostId !== null &&
        req.body.serviceId !== undefined &&
        req.body.serviceId !== null
    ) {
        return {
            hostId: Number(req.body.hostId),
            serviceId: Number(req.body.serviceId)
        };
    }

    const attempts = [];

    const runSearch = async (label, searchObject) => {
        try {
            const endpoint = buildServicesEndpoint({
                page: 1,
                limit: 100,
                search: searchObject
            });

            console.log(`Centreon resolve acknowledge resource [${label}]:`, endpoint);

            const response = await centreonAxios.get(endpoint, {
                headers: getCentreonHeaders(req)
            });

            const services = (response.data?.result || []).map(normalizeService);

            attempts.push({
                label,
                success: true,
                count: services.length
            });

            return services;

        } catch (error) {
            console.warn(`Resolve acknowledge search failed [${label}]`, {
                status: error.response?.status,
                data: error.response?.data,
                message: error.message
            });

            attempts.push({
                label,
                success: false,
                status: error.response?.status,
                data: error.response?.data,
                message: error.message
            });

            return [];
        }
    };

    let candidates = [];

    if (targetService) {
        const serviceResults = await runSearch("service.description", {
            "service.description": targetService
        });

        candidates.push(...serviceResults);
    }

    if (targetHost) {
        const hostResults = await runSearch("host.name", {
            "host.name": targetHost
        });

        candidates.push(...hostResults);
    }

    const merged = new Map();

    candidates.forEach((service) => {
        const key = service.id || `${service.host?.id}-${service.description}`;
        merged.set(key, service);
    });

    candidates = Array.from(merged.values());

    const hostLower = String(targetHost || "").toLowerCase();
    const serviceLower = String(targetService || "").toLowerCase();

    const exactMatch = candidates.find((item) => {
        const itemHostName = String(item.host?.name || item.host?.display_name || "").toLowerCase();
        const itemServiceName = String(item.description || item.display_name || "").toLowerCase();

        return itemHostName === hostLower && itemServiceName === serviceLower;
    });

    const looseMatch = candidates.find((item) => {
        const itemHostName = String(item.host?.name || item.host?.display_name || "").toLowerCase();
        const itemServiceName = String(item.description || item.display_name || "").toLowerCase();

        return itemHostName.includes(hostLower) && itemServiceName.includes(serviceLower);
    });

    const matchedService = exactMatch || looseMatch;

    if (!matchedService?.id || !matchedService?.host?.id) {
        const error = new Error("Unable to resolve Centreon host/service IDs for acknowledgement.");
        error.debug = {
            targetHost,
            targetService,
            attempts,
            candidateCount: candidates.length
        };
        throw error;
    }

    return {
        hostId: Number(matchedService.host.id),
        serviceId: Number(matchedService.id)
    };
};

const acknowledgeService = async (req, res, next) => {
    const {
        host,
        service,
        hostName,
        serviceDescription,
        comment
    } = req.body;

    const targetHost = host || hostName;
    const targetService = service || serviceDescription;
    const actionBy = getRequestUserName(req);

    if (!targetHost || !targetService) {
        return res.status(400).json({
            success: false,
            message: "host and service are required."
        });
    }

    const acknowledgeComment =
        comment ||
        `Acknowledged from GOC Dashboard by ${actionBy}`;

    let resolvedResource = null;

    try {
        const { hostId, serviceId } = await resolveServiceResourceIds(
            req,
            targetHost,
            targetService
        );

        resolvedResource = {
            hostId,
            serviceId
        };

        const payload = {
            resources: [
                {
                    type: "service",
                    id: serviceId,
                    parent: {
                        id: hostId
                    }
                }
            ],
            acknowledgement: {
                comment: acknowledgeComment
            }
        };

        console.log("Centreon acknowledge payload:", payload);

        const centreonResponse = await centreonAxios.post(
            "/monitoring/resources/acknowledge",
            payload,
            {
                headers: getCentreonHeaders(req)
            }
        );

        // Do not let audit-log DB failure reverse a successful Centreon acknowledgement.
        try {
            await writeAuditLog({
                host: targetHost,
                service: targetService,
                logType: "ACKNOWLEDGEMENT",
                oldStatus: null,
                newStatus: "ACKNOWLEDGED",
                actionBy,
                message: acknowledgeComment
            });
        } catch (logError) {
            console.error("Acknowledgement succeeded but audit log failed:", {
                message: logError.message,
                code: logError.code,
                sqlMessage: logError.sqlMessage
            });
        }

        return res.json({
            success: true,
            message: "Service acknowledged successfully.",
            auditLogged: true,
            resource: {
                host: targetHost,
                service: targetService,
                hostId,
                serviceId
            },
            centreon: centreonResponse.data
        });

    } catch (error) {
        console.error("Acknowledge failed:", {
            status: error.response?.status,
            data: error.response?.data,
            message: error.message,
            debug: error.debug,
            resolvedResource
        });

        try {
            await writeAuditLog({
                host: targetHost,
                service: targetService,
                logType: "ACKNOWLEDGEMENT_FAILED",
                oldStatus: null,
                newStatus: "FAILED",
                actionBy,
                message: `Failed to acknowledge ${targetHost} / ${targetService}: ${error.response?.data?.message || error.message}`
            });
        } catch (logError) {
            console.error("Failed to write failed-ack audit log:", {
                message: logError.message,
                code: logError.code,
                sqlMessage: logError.sqlMessage
            });
        }

        return handleCentreonError(error, res, next);
    }
};

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
    getAllHosts,
    getHostById,
    getHostStatus,
    getAllPollers,
    getPollerHosts,
    getPollerServiceSummary,
    getAllServices,
    getServicesByHost,
    searchServicesGlobally,
    getServiceStatusSummary,
    getGlobalServiceStatusSummary,
    getGlobalServiceStatusSummaryList,
    acknowledgeService,
    testMonitoringServers
};