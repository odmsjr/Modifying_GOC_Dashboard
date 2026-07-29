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

// Three separate caches for each status filter
let unhandledCache = {
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

let acknowledgedCache = {
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

let allCache = {
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
        code: error.code,
        debug: error.debug
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

    const acknowledgement =
        service.acknowledgement ||
        service.acknowledgements ||
        service.ack ||
        null;

    const isAcknowledged = Boolean(
        service.is_acknowledged === true ||
        service.is_acknowledged === 1 ||
        service.is_acknowledged === "1" ||
        service.is_acknowledged === "true" ||
        service.acknowledged === true ||
        service.acknowledged === 1 ||
        service.acknowledged === "1" ||
        service.acknowledged === "true" ||
        acknowledgement?.is_acknowledged === true ||
        acknowledgement?.is_acknowledged === 1 ||
        acknowledgement?.is_acknowledged === "1" ||
        acknowledgement?.is_acknowledged === "true" ||
        Boolean(acknowledgement?.author) ||
        Boolean(acknowledgement?.comment) ||
        Boolean(acknowledgement?.entry_time)
    );

    return {
        ...service,
        statusCode,
        statusName,
        is_acknowledged: isAcknowledged,
        acknowledged: isAcknowledged,
        acknowledgement: acknowledgement || service.acknowledgement || null,
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

    if (rawType) return rawType;

    const name = String(
        server.name ||
        server.poller_name ||
        server.server_name ||
        server.instance_name ||
        ""
    ).toLowerCase();

    if (name === "central" || name.includes("central")) return "Central";
    if (name.includes("remote")) return "Remote";
    if (name.includes("poller")) return "Poller";

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

const getOrCreateAuditServerId = async (hostName, hostAddress = null) => {
    const safeHostName = hostName || "Unknown Host";
    const safeHostAddress = hostAddress || safeHostName;

    const [existingRows] = await db.execute(
        `SELECT id, ip_address FROM servers WHERE hostname = ? LIMIT 1`,
        [safeHostName]
    );

    if (existingRows.length > 0) {
        const existingServer = existingRows[0];

        if (
            hostAddress &&
            (
                !existingServer.ip_address ||
                existingServer.ip_address === safeHostName ||
                existingServer.ip_address === "0.0.0.0"
            )
        ) {
            await db.execute(
                `UPDATE servers SET ip_address = ? WHERE id = ?`,
                [hostAddress, existingServer.id]
            );
        }

        return existingServer.id;
    }

    const [insertResult] = await db.execute(
        `
        INSERT INTO servers (hostname, ip_address)
        VALUES (?, ?)
        `,
        [safeHostName, safeHostAddress]
    );

    return insertResult.insertId;
};

const writeAuditLog = async ({
    host,
    hostAddress,
    service,
    logType,
    oldStatus,
    newStatus,
    actionBy,
    message
}) => {
    const serverId = await getOrCreateAuditServerId(host, hostAddress);
    const query = `
        INSERT INTO server_activity_log
        (server_id, incident_id, service_name, log_type, old_status, new_status, action_by, message)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const [insertResult] = await db.execute(query, [
        serverId,
        null,
        service || null,
        logType,
        oldStatus || null,
        newStatus || null,
        actionBy || "Dashboard User",
        message || null
    ]);

    return {
        serverId,
        auditLogId: insertResult.insertId
    };
};

// ============================================================
// ACKNOWLEDGEMENT HELPERS
// ============================================================

const fetchAcknowledgements = async (req) => {
    const hostAckIds = new Set();
    const serviceAckIds = new Set();

    const limit = 1000;
    let page = 1;
    let totalFetched = 0;
    let totalHostAcks = 0;

    try {
        // Fetch acknowledged hosts
        while (true) {
            const endpoint = `/monitoring/hosts?page=${page}&limit=${limit}&search={"host.is_acknowledged":true}`;
            console.log("📋 Fetching acknowledged hosts:", endpoint);

            const response = await centreonAxios.get(endpoint, {
                headers: getCentreonHeaders(req)
            });

            const hosts = response.data?.result || [];
            totalHostAcks = response.data?.meta?.total || hosts.length;

            hosts.forEach((host) => {
                if (host.id) {
                    hostAckIds.add(host.id);
                }
            });

            totalFetched += hosts.length;
            if (totalFetched >= totalHostAcks || hosts.length === 0) break;
            page += 1;
        }

        console.log(`✅ Acknowledged hosts: ${hostAckIds.size}`);

        // Fetch service acknowledgements
        page = 1;
        totalFetched = 0;
        let totalServiceAcks = 0;

        while (true) {
            const endpoint = `/monitoring/services/acknowledgements?page=${page}&limit=${limit}`;
            console.log("📋 Fetching service acknowledgements:", endpoint);

            const response = await centreonAxios.get(endpoint, {
                headers: getCentreonHeaders(req)
            });

            const services = response.data?.result || [];
            totalServiceAcks = response.data?.meta?.total || services.length;

            services.forEach((ack) => {
                if (ack.service_id) serviceAckIds.add(ack.service_id);
            });

            totalFetched += services.length;
            if (totalFetched >= totalServiceAcks || services.length === 0) break;
            page += 1;
        }

        console.log(`✅ Service acknowledgements: ${serviceAckIds.size}`);

        return { hostAckIds, serviceAckIds };

    } catch (error) {
        console.error("Failed to fetch acknowledgements:", error);
        return { hostAckIds: new Set(), serviceAckIds: new Set() };
    }
};

// ============================================================
// CACHE REFRESH FUNCTIONS
// ============================================================

const refreshCacheWithFilter = async (req, filterName, searchFilter, targetCache) => {
    if (targetCache.isRefreshing) return;

    targetCache.isRefreshing = true;

    try {
        // Fetch acknowledgements
        const { hostAckIds, serviceAckIds } = await fetchAcknowledgements(req);
        console.log(`🔍 ${filterName} - hostAckIds size: ${hostAckIds.size}`);
        console.log(`🔍 ${filterName} - serviceAckIds size: ${serviceAckIds.size}`);

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
                limit,
                search: searchFilter
            });

            console.log(`🔍 Fetching ${filterName} services:`, endpoint);

            const response = await centreonAxios.get(endpoint, {
                headers: getCentreonHeaders(req)
            });

            const services = response.data?.result || [];
            const normalizedServices = services.map(normalizeService);

            normalizedServices.forEach((service) => {
                if (![1, 2, 3].includes(service.statusCode)) return;

                const isHostAck = hostAckIds.has(service.host?.id);
                const isServiceAck = serviceAckIds.has(service.id) || service.is_acknowledged;

                // For unhandled cache: skip if host is acknowledged OR service is acknowledged
                if (filterName === 'unhandled') {
                    if (isHostAck || isServiceAck) {
                        // Debug: log skipped services
                        if (service.statusCode === 2) {
                            console.log(`🔍 Skipping critical (acknowledged): ${service.host?.name} - ${service.description} (hostAck: ${isHostAck}, serviceAck: ${isServiceAck})`);
                        }
                        return;
                    }
                }

                // For acknowledged cache: only keep if host OR service is acknowledged
                if (filterName === 'acknowledged') {
                    if (!isHostAck && !isServiceAck) return;
                }

                // Add to severity lists
                if (service.statusCode === 2) criticalServices.push(service);
                else if (service.statusCode === 1) warningServices.push(service);
                else if (service.statusCode === 3) unknownServices.push(service);
            });

            totalFromCentreon = response.data?.meta?.total || services.length;
            counted += services.length;

            if (counted >= totalFromCentreon || services.length === 0) break;
            page += 1;
        }

        // Update cache
        targetCache.counts = {
            allActiveIssues: criticalServices.length + warningServices.length + unknownServices.length,
            critical: criticalServices.length,
            warning: warningServices.length,
            unknown: unknownServices.length
        };
        targetCache.services = {
            critical: criticalServices,
            warning: warningServices,
            unknown: unknownServices
        };
        targetCache.updatedAt = Date.now();
        targetCache.isRefreshing = false;
        targetCache.lastError = null;

        console.log(`✅ ${filterName} cache refreshed:`, targetCache.counts);

        // Log sample of critical services for debugging
        if (criticalServices.length > 0) {
            console.log(`🔍 Sample critical services after filtering (first 5):`);
            criticalServices.slice(0, 5).forEach(s => {
                console.log(`   - ${s.host?.name} - ${s.description} (${s.statusName})`);
            });
        }

    } catch (error) {
        console.error(`Failed refreshing ${filterName} cache:`, error);
        targetCache.isRefreshing = false;
        targetCache.lastError = {
            status: error.response?.status,
            data: error.response?.data,
            message: error.message
        };
    }
};

// ============================================================
// ACK / UNACK CACHE PATCH HELPERS
// ============================================================

const patchCache = (cache, hostId, serviceId, hostName, serviceDescription, patchFn) => {
    let patchedCount = 0;

    const matchService = (service) => {
        const currentServiceId = service.id;
        const currentHostId = service.host?.id;

        const currentHostName = String(service.host?.name || service.host?.display_name || '').toLowerCase();
        const currentServiceDescription = String(service.description || service.display_name || '').toLowerCase();

        if (serviceId !== null && serviceId !== undefined) {
            return String(currentServiceId) === String(serviceId);
        }
        if (hostId !== null && hostId !== undefined) {
            return (
                String(currentHostId) === String(hostId) &&
                currentServiceDescription === serviceDescription
            );
        }
        return (
            currentHostName === hostName &&
            currentServiceDescription === serviceDescription
        );
    };

    const patchService = (service) => {
        if (!matchService(service)) return service;
        patchedCount += 1;
        return patchFn(service);
    };

    const services = {
        critical: (cache.services.critical || []).map(patchService),
        warning: (cache.services.warning || []).map(patchService),
        unknown: (cache.services.unknown || []).map(patchService)
    };

    cache.services = services;
    cache.counts = {
        allActiveIssues: services.critical.length + services.warning.length + services.unknown.length,
        critical: services.critical.length,
        warning: services.warning.length,
        unknown: services.unknown.length
    };

    return patchedCount;
};

const markCacheServiceAsAcknowledged = (cache, hostId, serviceId, hostName, serviceDescription, actionBy, comment) => {
    return patchCache(cache, hostId, serviceId, hostName, serviceDescription, (service) => ({
        ...service,
        is_acknowledged: true,
        acknowledged: true,
        acknowledgement: {
            ...(typeof service.acknowledgement === 'object' ? service.acknowledgement : {}),
            is_acknowledged: true,
            author: actionBy || 'Dashboard User',
            comment: comment || 'Acknowledged from GOC Dashboard',
            entry_time: new Date().toISOString()
        }
    }));
};

const markCacheServiceAsUnacknowledged = (cache, hostId, serviceId, hostName, serviceDescription) => {
    return patchCache(cache, hostId, serviceId, hostName, serviceDescription, (service) => ({
        ...service,
        is_acknowledged: false,
        acknowledged: false,
        acknowledgement: null
    }));
};

// ============================================================
// MONITORING SERVER / CACHE HELPERS
// ============================================================

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

            if (counted >= totalFromCentreon || servers.length === 0) break;
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
    if (pollerHostCountCache.isRefreshing) return;

    pollerHostCountCache.isRefreshing = true;

    try {
        const countMap = {};
        const hostsByPoller = {};
        const limit = 1000;
        let page = 1;
        let counted = 0;
        let totalFromCentreon = 0;

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

        while (true) {
            const endpoint = `/monitoring/hosts?page=${page}&limit=${limit}`;

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

                if (state === 0) countMap[pollerId].upHosts += 1;
                else if (state === 1) countMap[pollerId].downHosts += 1;
                else if (state === 2) countMap[pollerId].unreachableHosts += 1;
                else if (state === 3) countMap[pollerId].pendingHosts += 1;
            });

            counted += hosts.length;

            if (counted >= totalFromCentreon || hosts.length === 0) break;
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

// ============================================================
// HOST ENDPOINTS
// ============================================================

const getAllHosts = async (req, res, next) => {
    try {
        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 100;

        const endpoint = `/monitoring/hosts?page=${page}&limit=${limit}`;

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

        const endpoint = `/monitoring/hosts?page=${page}&limit=${limit}`;

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
                hostCountUpdatedAt: pollerHostCountCache.updatedAt
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

        if (!hasFreshCache && !pollerHostCountCache.isRefreshing) {
            refreshPollerHostCountCache(req, monitoringServerMap);
        }

        const allHostsForPoller =
            pollerHostCountCache.hostsByPoller?.[String(pollerId)] || [];

        if (!hasAnyCache) {
            return res.json({
                success: true,
                poller_id: pollerId,
                poller_name: mappedServer?.name || `Poller ${pollerId}`,
                poller_address: mappedServer?.address || "",
                poller_server_type: mappedServer?.server_type || "",
                count: 0,
                data: { result: [] },
                meta: {
                    page,
                    limit,
                    total: 0,
                    totalPages: 1,
                    hostCacheLoaded: false,
                    hostCacheRefreshing: pollerHostCountCache.isRefreshing
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
                hostCacheUpdatedAt: pollerHostCountCache.updatedAt
            }
        });

    } catch (error) {
        return handleCentreonError(error, res, next);
    }
};

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
            }
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

                const normalizedServices = (response.data?.result || []).map(normalizeService);

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
            }
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

        const normalizedServices = (response.data?.result || []).map(normalizeService);

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
// SUMMARY ENDPOINTS
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

        const normalizedServices = (response.data?.result || []).map(normalizeService);

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
            }
        });

    } catch (error) {
        return handleCentreonError(error, res, next);
    }
};

// ✅ getGlobalServiceStatusSummary - Uses unhandled cache for stats cards
const getGlobalServiceStatusSummary = async (req, res, next) => {
    try {
        const now = Date.now();

        const hasCachedCounts =
            unhandledCache.updatedAt && unhandledCache.counts.allActiveIssues !== null;

        const hasFreshCache =
            unhandledCache.updatedAt &&
            now - unhandledCache.updatedAt < DASHBOARD_GLOBAL_SUMMARY_CACHE_TTL_MS;

        if (!hasFreshCache && !unhandledCache.isRefreshing) {
            const searchFilter = {
                "$and": {
                    "service.is_acknowledged": false,
                    "service.state": { "$in": [1, 2, 3] }
                }
            };
            refreshCacheWithFilter(req, 'unhandled', searchFilter, unhandledCache);
        }

        return res.json({
            success: true,
            cached: Boolean(hasCachedCounts),
            refreshing: unhandledCache.isRefreshing,
            counts: unhandledCache.counts || {
                allActiveIssues: null,
                critical: null,
                warning: null,
                unknown: null
            },
            services: unhandledCache.services || {
                critical: [],
                warning: [],
                unknown: []
            },
            meta: {
                cacheLoaded: Boolean(hasCachedCounts),
                cacheFresh: Boolean(hasFreshCache),
                cacheRefreshing: unhandledCache.isRefreshing,
                cacheUpdatedAt: unhandledCache.updatedAt,
                cacheTtlMs: DASHBOARD_GLOBAL_SUMMARY_CACHE_TTL_MS,
                lastError: unhandledCache.lastError
            }
        });
    } catch (error) {
        return handleCentreonError(error, res, next);
    }
};

// ✅ getGlobalServiceStatusSummaryList - Uses appropriate cache based on statusFilter
const getGlobalServiceStatusSummaryList = async (req, res, next) => {
    try {
        const type = String(req.query.type || "all").toLowerCase();
        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 100;
        const hostSearch = String(req.query.host || "").trim().toLowerCase();
        const serviceSearch = String(req.query.service || "").trim().toLowerCase();
        const qSearch = String(req.query.q || "").trim().toLowerCase();

        const statusFilter = String(req.query.statusFilter || "unhandled").toLowerCase();

        let cache;
        let filterName;
        let searchFilter;

        if (statusFilter === 'unhandled') {
            cache = unhandledCache;
            filterName = 'unhandled';
            searchFilter = {
                "$and": {
                    "service.is_acknowledged": false,
                    "service.state": { "$in": [1, 2, 3] }
                }
            };
        } else if (statusFilter === 'acknowledged') {
                    cache = acknowledgedCache;
            filterName = 'acknowledged';
            searchFilter = {
                "$and": {
                    "service.is_acknowledged": true,
                    "service.state": { "$in": [1, 2, 3] }
                }
            };
        } else {
            cache = allCache;
            filterName = 'all';
            searchFilter = {
                "service.state": { "$in": [1, 2, 3] }
            };
        }

        const cacheAge = cache.updatedAt ? Date.now() - cache.updatedAt : Infinity;
        const isStale = cacheAge > DASHBOARD_GLOBAL_SUMMARY_CACHE_TTL_MS;

        if ((isStale || !cache.updatedAt) && !cache.isRefreshing) {
            refreshCacheWithFilter(req, filterName, searchFilter, cache);
        }

        if (!cache.updatedAt) {
            return res.json({
                success: true,
                cached: false,
                refreshing: cache.isRefreshing,
                type,
                statusFilter,
                query: { host: hostSearch, service: serviceSearch, q: qSearch },
                counts: cache.counts || { allActiveIssues: 0, critical: 0, warning: 0, unknown: 0 },
                filteredCounts: { allActiveIssues: 0, critical: 0, warning: 0, unknown: 0 },
                data: { result: [] },
                meta: {
                    page,
                    limit,
                    total: 0,
                    totalPages: 1,
                    filteredTotal: 0,
                    cacheLoaded: false,
                    cacheFresh: false,
                    cacheRefreshing: cache.isRefreshing,
                    cacheUpdatedAt: cache.updatedAt
                }
            });
        }

        let criticalServices = cache.services.critical || [];
        let warningServices = cache.services.warning || [];
        let unknownServices = cache.services.unknown || [];

        const allActiveServices = [...criticalServices, ...warningServices, ...unknownServices];

        let filteredAllStatusServices = allActiveServices;

        if (hostSearch || serviceSearch || qSearch) {
            filteredAllStatusServices = allActiveServices.filter((service) => {
                const hostName = String(service.host?.name || "").toLowerCase();
                const hostDisplayName = String(service.host?.display_name || "").toLowerCase();
                const hostAlias = String(service.host?.alias || "").toLowerCase();

                const serviceDescription = String(service.description || "").toLowerCase();
                const serviceDisplayName = String(service.display_name || "").toLowerCase();
                const output = String(service.output || "").toLowerCase();

                const matchesHost =
                    !hostSearch ||
                    hostName.includes(hostSearch) ||
                    hostDisplayName.includes(hostSearch) ||
                    hostAlias.includes(hostSearch);

                const matchesService =
                    !serviceSearch ||
                    serviceDescription.includes(serviceSearch) ||
                    serviceDisplayName.includes(serviceSearch) ||
                    output.includes(serviceSearch);

                const matchesQ =
                    !qSearch ||
                    hostName.includes(qSearch) ||
                    hostDisplayName.includes(qSearch) ||
                    hostAlias.includes(qSearch) ||
                    serviceDescription.includes(qSearch) ||
                    serviceDisplayName.includes(qSearch) ||
                    output.includes(qSearch);

                return matchesHost && matchesService && matchesQ;
            });
        }

        const filteredCritical = filteredAllStatusServices.filter(service => service.statusCode === 2);
        const filteredWarning = filteredAllStatusServices.filter(service => service.statusCode === 1);
        const filteredUnknown = filteredAllStatusServices.filter(service => service.statusCode === 3);

        const filteredCounts = {
            allActiveIssues: filteredCritical.length + filteredWarning.length + filteredUnknown.length,
            critical: filteredCritical.length,
            warning: filteredWarning.length,
            unknown: filteredUnknown.length
        };

        let selectedServices = [];

        if (type === "critical") selectedServices = filteredCritical;
        else if (type === "warning") selectedServices = filteredWarning;
        else if (type === "unknown") selectedServices = filteredUnknown;
        else selectedServices = filteredAllStatusServices;

        const startIndex = (page - 1) * limit;
        const pagedServices = selectedServices.slice(startIndex, startIndex + limit);

        return res.json({
            success: true,
            cached: Boolean(cache.updatedAt),
            refreshing: cache.isRefreshing,
            type,
            statusFilter,
            query: { host: hostSearch, service: serviceSearch, q: qSearch },
            counts: cache.counts || { allActiveIssues: 0, critical: 0, warning: 0, unknown: 0 },
            filteredCounts,
            data: { result: pagedServices },
            meta: {
                page,
                limit,
                total: selectedServices.length,
                totalPages: Math.max(1, Math.ceil(selectedServices.length / limit)),
                filteredTotal: filteredAllStatusServices.length,
                cacheLoaded: Boolean(cache.updatedAt),
                cacheFresh: !isStale,
                cacheRefreshing: cache.isRefreshing,
                cacheUpdatedAt: cache.updatedAt,
                cacheAgeMs: cacheAge,
                cacheTtlMs: DASHBOARD_GLOBAL_SUMMARY_CACHE_TTL_MS
            }
        });
    } catch (error) {
        return handleCentreonError(error, res, next);
    }
};

// ============================================================
// ACKNOWLEDGEMENT ACTIONS
// ============================================================

const resolveServiceResourceIds = async (req, targetHost, targetService) => {
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
        hostAddress,
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
        `Acknowledged By ${actionBy}`;

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

        const patchCount = (cache) => markCacheServiceAsAcknowledged(
            cache,
            hostId,
            serviceId,
            targetHost,
            targetService,
            actionBy,
            acknowledgeComment
        );

        const patchedUnhandled = patchCount(unhandledCache);
        const patchedAcknowledged = patchCount(acknowledgedCache);
        const patchedAll = patchCount(allCache);

        let auditLogged = false;
        let auditError = null;
        let auditLogId = null;
        let auditServerId = null;

        try {
            const auditResult = await writeAuditLog({
                host: targetHost,
                hostAddress,
                service: targetService,
                logType: "ACKNOWLEDGEMENT",
                oldStatus: null,
                newStatus: "ACKNOWLEDGED",
                actionBy,
                message: acknowledgeComment
            });

            auditLogged = true;
            auditLogId = auditResult.auditLogId;
            auditServerId = auditResult.serverId;

        } catch (logError) {
            auditError = {
                message: logError.message,
                code: logError.code,
                sqlMessage: logError.sqlMessage
            };

            console.error("Acknowledgement succeeded but audit log failed:", auditError);
        }

        return res.json({
            success: true,
            message: "Service acknowledged successfully.",
            auditLogged,
            auditLogId,
            auditServerId,
            auditError,
            cachePatchedCount: { unhandled: patchedUnhandled, acknowledged: patchedAcknowledged, all: patchedAll },
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

const unacknowledgeService = async (req, res, next) => {
    const {
        host,
        service,
        hostAddress,
        hostName,
        serviceDescription
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
            ]
        };

        const centreonResponse = await sendCentreonUnacknowledgeRequest(req, payload);

        const patchCount = (cache) => markCacheServiceAsUnacknowledged(
            cache,
            hostId,
            serviceId,
            targetHost,
            targetService
        );

        const patchedUnhandled = patchCount(unhandledCache);
        const patchedAcknowledged = patchCount(acknowledgedCache);
        const patchedAll = patchCount(allCache);

        let auditLogged = false;
        let auditError = null;
        let auditLogId = null;
        let auditServerId = null;

        try {
            const auditResult = await writeAuditLog({
                host: targetHost,
                hostAddress,
                service: targetService,
                logType: "UNACKNOWLEDGEMENT",
                oldStatus: "ACKNOWLEDGED",
                newStatus: "PENDING",
                actionBy,
                message: `Unacknowledged from GOC Dashboard by ${actionBy}`
            });

            auditLogged = true;
            auditLogId = auditResult.auditLogId;
            auditServerId = auditResult.serverId;

        } catch (logError) {
            auditError = {
                message: logError.message,
                code: logError.code,
                sqlMessage: logError.sqlMessage
            };

            console.error("Unacknowledgement succeeded but audit log failed:", auditError);
        }

        return res.json({
            success: true,
            message: "Service unacknowledged successfully.",
            auditLogged,
            auditLogId,
            auditServerId,
            auditError,
            cachePatchedCount: { unhandled: patchedUnhandled, acknowledged: patchedAcknowledged, all: patchedAll },
            resource: {
                host: targetHost,
                service: targetService,
                hostId,
                serviceId
            },
            centreon: centreonResponse.data
        });

    } catch (error) {
        console.error("Unacknowledge failed:", {
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
                logType: "UNACKNOWLEDGEMENT_FAILED",
                oldStatus: "ACKNOWLEDGED",
                newStatus: "FAILED",
                actionBy,
                message: `Failed to unacknowledge ${targetHost} / ${targetService}: ${error.response?.data?.message || error.message}`
            });
        } catch (logError) {
            console.error("Failed to write failed-unack audit log:", {
                message: logError.message,
                code: logError.code,
                sqlMessage: logError.sqlMessage
            });
        }

        return res.status(error.response?.status || 500).json({
            success: false,
            message: error.message || "Unacknowledge failed.",
            status: error.response?.status,
            data: error.response?.data,
            debug: error.debug || null
        });
    }
};

const sendCentreonUnacknowledgeRequest = async (req, payload) => {
    const resource = payload.resources?.[0];
    const hostId = resource?.parent?.id ?? resource?.host_id ?? resource?.hostId;
    const serviceId = resource?.id ?? resource?.service_id ?? resource?.serviceId;

    if (!hostId || !serviceId) {
        const error = new Error("Missing hostId or serviceId for Centreon unacknowledge.");
        error.debug = { payload, hostId, serviceId };
        throw error;
    }

    const attempts = [
        {
            label: "DELETE /monitoring/hosts/{hostId}/services/{serviceId}/acknowledgements",
            method: "delete",
            endpoint: `/monitoring/hosts/${hostId}/services/${serviceId}/acknowledgements`,
            data: null
        },
        {
            label: "DELETE /monitoring/resources/acknowledgements",
            method: "delete",
            endpoint: "/monitoring/resources/acknowledgements",
            data: {
                disacknowledgement: { with_services: false },
                resources: payload.resources
            }
        }
    ];

    const errors = [];

    for (const attempt of attempts) {
        try {
            console.log(`Centreon unacknowledge attempt [${attempt.label}]:`, {
                endpoint: attempt.endpoint,
                data: attempt.data
            });
            return await centreonAxios.delete(attempt.endpoint, {
                headers: getCentreonHeaders(req),
                data: attempt.data || undefined
            });
        } catch (error) {
            errors.push({
                label: attempt.label,
                endpoint: attempt.endpoint,
                status: error.response?.status,
                data: error.response?.data,
                message: error.message
            });
            console.warn(`Centreon unacknowledge failed [${attempt.label}]`, {
                endpoint: attempt.endpoint,
                status: error.response?.status,
                data: error.response?.data,
                message: error.message
            });
        }
    }

    const finalError = new Error("All Centreon unacknowledge attempts failed.");
    finalError.debug = errors;
    throw finalError;
};

// ============================================================
// DEBUG ENDPOINT
// ============================================================

const testMonitoringServers = async (req, res, next) => {
    try {
        const allServers = [];
        const limit = Number(req.query.limit) || 1000;
        let page = 1;
        let counted = 0;
        let totalFromCentreon = 0;

        while (true) {
            const endpoint = `/configuration/monitoring-servers?page=${page}&limit=${limit}`;

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

            if (counted >= totalFromCentreon || servers.length === 0) break;
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
    unacknowledgeService,
    testMonitoringServers
};