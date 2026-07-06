import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import Sla from "./SLA";
import Logs from "./Logs";
import "../Dashboard.css";

const BASE_API_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';

export default function Dashboard() {
    const location = useLocation();
    const navigate = useNavigate();

    // --- SYSTEM TIME ---
    const [lastUpdated, setLastUpdated] = useState(new Date().toLocaleTimeString());

    // --- DASHBOARD LAYER STATE ---
    const [currentTableType, setCurrentTableType] = useState('all');
    const [filters, setFilters] = useState({ host: '', service: '', poller: 'all' });
    const [showAllStatusesForPoller, setShowAllStatusesForPoller] = useState(true);

    // --- SERVICE PAGINATION STATE ---
    const [servicePage, setServicePage] = useState(1);
    const [serviceLimit, setServiceLimit] = useState(100);
    const [serviceMeta, setServiceMeta] = useState({
        page: 1,
        limit: 100,
        total: 0
    });
    const [isLoadingServices, setIsLoadingServices] = useState(false);

    // --- DASHBOARD PAGE-BASED COUNTS ---
    const [counts, setCounts] = useState({
        allActiveIssues: 0,
        critical: 0,
        warning: 0,
        unknown: 0
    });

    // --- DASHBOARD GLOBAL CACHED COUNTS ---
    const [globalDashboardCounts, setGlobalDashboardCounts] = useState({
        allActiveIssues: null,
        critical: null,
        warning: null,
        unknown: null
    });

    const [isRefreshingGlobalSummary, setIsRefreshingGlobalSummary] = useState(false);

    const [dashboardGlobalServices, setDashboardGlobalServices] = useState([]);
    const [dashboardGlobalMeta, setDashboardGlobalMeta] = useState({
        page: 1,
        limit: 100,
        total: 0,
        totalPages: 1
    });
    const [isLoadingDashboardGlobalList, setIsLoadingDashboardGlobalList] = useState(false);

    // Prevent stale search requests from overwriting newer results.
    const dashboardGlobalListRequestIdRef = useRef(0);

    const [cachedCritical, setCachedCritical] = useState([]);
    const [cachedWarning, setCachedWarning] = useState([]);
    const [cachedUnknown, setCachedUnknown] = useState([]);
    const [cachedSearchResults, setCachedSearchResults] = useState([]);
    const [pollerDropdownList, setPollerDropdownList] = useState([]);

    // --- POLLERS PAGE STATE ---
    const [cachedPollers, setCachedPollers] = useState([]);
    const [pollerSearch, setPollerSearch] = useState('');
    const [selectedPoller, setSelectedPoller] = useState(null);
    const [selectedPollerId, setSelectedPollerId] = useState(null);

    const [pollerHosts, setPollerHosts] = useState([]);
    const [pollerHostPage, setPollerHostPage] = useState(1);
    const [pollerHostLimit] = useState(20);
    const [pollerHostMeta, setPollerHostMeta] = useState({
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 1
    });
    const [isLoadingPollerHosts, setIsLoadingPollerHosts] = useState(false);

    // --- SELECTED POLLER SERVICES STATE ---
    const [pollerServices, setPollerServices] = useState([]);
    const [isLoadingPollerServices, setIsLoadingPollerServices] = useState(false);

    const [pollerServiceCounts, setPollerServiceCounts] = useState({
        allActiveIssues: null,
        critical: null,
        warning: null,
        unknown: null
    });

    // --- GLOBAL SEARCH STATE ---
    const [debouncedHostSearch, setDebouncedHostSearch] = useState('');
    const [debouncedServiceSearch, setDebouncedServiceSearch] = useState('');

    // ============================================================
    // NORMALIZER HELPERS
    // ============================================================
    const normalizeHost = (host) => {
        return {
            ...host,
            poller_name:
                host.poller_name ||
                (host.poller_id ? `Poller ${host.poller_id}` : 'Default Poller')
        };
    };

    const normalizeService = (service) => {
        const statusCode = Number(service.statusCode ?? service.status?.code ?? service.state);

        const statusName = String(
            service.statusName ||
            service.status?.name ||
            (
                statusCode === 0 ? 'OK' :
                statusCode === 1 ? 'WARNING' :
                statusCode === 2 ? 'CRITICAL' :
                statusCode === 3 ? 'UNKNOWN' :
                'UNKNOWN'
            )
        ).toUpperCase();

        return {
            ...service,
            statusCode,
            statusName,
            poller_name:
                service.poller_name ||
                service.host?.poller_name ||
                (service.host?.poller_id ? `Poller ${service.host.poller_id}` : 'Default Poller')
        };
    };

    const getHostStateName = (host) => {
        const state = Number(host.state);

        if (state === 0) return 'UP';
        if (state === 1) return 'DOWN';
        if (state === 2) return 'UNREACHABLE';
        if (state === 3) return 'PENDING';

        return host.status?.name || 'UNKNOWN';
    };

    const getHostStateClass = (host) => {
        const stateName = getHostStateName(host);

        if (stateName === 'UP') return 'ok';
        if (stateName === 'DOWN') return 'critical';
        if (stateName === 'UNREACHABLE') return 'unknown';
        if (stateName === 'PENDING') return 'warning';

        return 'unknown';
    };

    const buildServiceCounts = (services) => {
        const critical = services.filter(service => service.statusCode === 2).length;
        const warning = services.filter(service => service.statusCode === 1).length;
        const unknown = services.filter(service => service.statusCode === 3).length;

        return {
            allActiveIssues: critical + warning + unknown,
            critical,
            warning,
            unknown
        };
    };

    // ============================================================
    // ROUTER RESET
    // ============================================================
    useEffect(() => {
        if (location.pathname === '/dashboard' && location.state) {
            const { poller, type } = location.state;

            setFilters(f => ({ ...f, poller: poller || 'all' }));

            if (type === 'all') {
                setShowAllStatusesForPoller(true);
                setCurrentTableType('all');
            } else {
                setShowAllStatusesForPoller(false);
                setCurrentTableType(type || 'critical');
            }

            navigate('/dashboard', { replace: true, state: null });
        }

        if (location.pathname !== '/pollers') {
            setSelectedPoller(null);
            setSelectedPollerId(null);
            setPollerHosts([]);
            setPollerServices([]);
            setPollerServiceCounts({
                allActiveIssues: null,
                critical: null,
                warning: null,
                unknown: null
            });
        }
    }, [location, navigate]);

    // ============================================================
    // SEARCH DEBOUNCE
    // ============================================================
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedHostSearch(filters.host.trim());
            setServicePage(1);
        }, 500);

        return () => clearTimeout(timer);
    }, [filters.host]);

    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedServiceSearch(filters.service.trim());
            setServicePage(1);
        }, 500);

        return () => clearTimeout(timer);
    }, [filters.service]);

    // ============================================================
    // GLOBAL DASHBOARD SUMMARY FETCH
    // ============================================================
    const fetchGlobalDashboardSummary = useCallback(async (shouldUpdateCards = true) => {
        try {
            const token = localStorage.getItem('centreon_auth_token');

            const response = await fetch(
                `${BASE_API_URL}/api/centreon/services/status/global-summary`,
                {
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                }
            );

            if (!response.ok) {
                throw new Error(`HTTP Error ${response.status}`);
            }

            const payload = await response.json();

            setIsRefreshingGlobalSummary(Boolean(payload.refreshing));

            if (shouldUpdateCards && payload.counts && payload.cached) {
                setGlobalDashboardCounts({
                    allActiveIssues: payload.counts.allActiveIssues,
                    critical: payload.counts.critical,
                    warning: payload.counts.warning,
                    unknown: payload.counts.unknown
                });
            }

            if (payload.meta?.cacheRefreshing && !payload.meta?.cacheFresh) {
                setTimeout(() => {
                    fetchGlobalDashboardSummary(shouldUpdateCards);
                }, 10000);
            }

        } catch (error) {
            console.error("Error fetching global dashboard summary:", error);
        }
    }, []);

    const fetchDashboardGlobalServiceList = useCallback(async (
        type = 'all',
        page = 1,
        limit = 100,
        hostSearch = '',
        serviceSearch = ''
    ) => {
        const requestId = dashboardGlobalListRequestIdRef.current + 1;
        dashboardGlobalListRequestIdRef.current = requestId;

        const isLatestRequest = () => dashboardGlobalListRequestIdRef.current === requestId;

        try {
            setIsLoadingDashboardGlobalList(true);

            const token = localStorage.getItem('centreon_auth_token');

            const params = new URLSearchParams({
                type,
                page: String(page),
                limit: String(limit)
            });

            if (hostSearch) {
                params.set('host', hostSearch);
            }

            if (serviceSearch) {
                params.set('service', serviceSearch);
            }

            const response = await fetch(
                `${BASE_API_URL}/api/centreon/services/status/global-summary/list?${params.toString()}`,
                {
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                }
            );

            if (!response.ok) {
                throw new Error(`HTTP Error ${response.status}`);
            }

            const payload = await response.json();

            // Ignore stale responses, such as older search returning after newer clear/search.
            if (!isLatestRequest()) {
                return;
            }

            setIsRefreshingGlobalSummary(Boolean(payload.refreshing));

            if (payload.cached) {
                const hasSearch = Boolean(hostSearch || serviceSearch);

                const countSource =
                    hasSearch && payload.filteredCounts
                        ? payload.filteredCounts
                        : payload.counts;

                if (countSource) {
                    setGlobalDashboardCounts({
                        allActiveIssues: countSource.allActiveIssues,
                        critical: countSource.critical,
                        warning: countSource.warning,
                        unknown: countSource.unknown
                    });
                }
            }

            setDashboardGlobalServices(payload.data?.result || []);
            setDashboardGlobalMeta(payload.meta || {
                page,
                limit,
                total: 0,
                totalPages: 1
            });

            if (payload.meta?.cacheRefreshing && !payload.meta?.cacheFresh) {
                setTimeout(() => {
                    if (isLatestRequest()) {
                        fetchDashboardGlobalServiceList(
                            type,
                            page,
                            limit,
                            hostSearch,
                            serviceSearch
                        );
                    }
                }, 10000);
            }

        } catch (error) {
            if (!isLatestRequest()) {
                return;
            }

            console.error("Error fetching dashboard global service list:", error);

            setDashboardGlobalServices([]);
            setDashboardGlobalMeta({
                page,
                limit,
                total: 0,
                totalPages: 1
            });

        } finally {
            if (isLatestRequest()) {
                setIsLoadingDashboardGlobalList(false);
            }
        }
    }, []);

    // ============================================================
    // DASHBOARD FETCH
    // ============================================================
    const refreshDashboardData = useCallback(async () => {
        const usingDashboardGlobalCache =
            location.pathname === '/dashboard' &&
            filters.poller === 'all';

        const hasDashboardSearch = Boolean(debouncedHostSearch || debouncedServiceSearch);

        try {
            if (usingDashboardGlobalCache) {
                setIsLoadingServices(false);
            } else {
                setIsLoadingServices(true);
            }

            // Do not let global summary overwrite filtered search card counts.
            fetchGlobalDashboardSummary(
                !(usingDashboardGlobalCache && hasDashboardSearch)
            );

            const token = localStorage.getItem('centreon_auth_token');

            const fetchOptions = {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            };

            // If Dashboard is using global cache mode, do not run old service summary/search.
            // This avoids UI flicker/twitching because the global list endpoint controls the table.
            if (usingDashboardGlobalCache) {
                const hostsRes = await fetch(
                    `${BASE_API_URL}/api/centreon/hosts/status/all`,
                    fetchOptions
                );

                if (!hostsRes.ok) {
                    throw new Error("Hosts API payload error");
                }

                const hostsPayload = await hostsRes.json();
                const rawHosts = hostsPayload.data?.result || [];
                const normalizedHosts = rawHosts.map(normalizeHost);

                const uniquePollers = [
                    ...new Set(
                        normalizedHosts
                            .map(h => h.poller_name)
                            .filter(Boolean)
                    )
                ];

                setPollerDropdownList(uniquePollers);
                setLastUpdated(new Date().toLocaleTimeString());

                return;
            }

            const hasGlobalSearch = Boolean(debouncedHostSearch || debouncedServiceSearch);

            const servicesEndpoint = hasGlobalSearch
                ? `${BASE_API_URL}/api/centreon/services/search?host=${encodeURIComponent(debouncedHostSearch)}&service=${encodeURIComponent(debouncedServiceSearch)}&page=${servicePage}&limit=${serviceLimit}`
                : `${BASE_API_URL}/api/centreon/services/status/summary?page=${servicePage}&limit=${serviceLimit}`;

            const [hostsRes, summaryRes] = await Promise.all([
                fetch(`${BASE_API_URL}/api/centreon/hosts/status/all`, fetchOptions),
                fetch(servicesEndpoint, fetchOptions)
            ]);

            if (!hostsRes.ok || !summaryRes.ok) {
                throw new Error("API Connection payload error");
            }

            const hostsPayload = await hostsRes.json();
            const summaryPayload = await summaryRes.json();

            const rawHosts = hostsPayload.data?.result || [];
            const allReturnedServices = (summaryPayload.data?.result || []).map(normalizeService);

            const criticals = (summaryPayload.services?.critical || []).map(normalizeService);
            const warnings = (summaryPayload.services?.warning || []).map(normalizeService);
            const unknowns = (summaryPayload.services?.unknown || []).map(normalizeService);

            setCachedCritical(criticals);
            setCachedWarning(warnings);
            setCachedUnknown(unknowns);

            if (hasGlobalSearch) {
                setCachedSearchResults(allReturnedServices);
            } else {
                setCachedSearchResults([]);
            }

            const criticalCount = summaryPayload.counts?.critical ?? criticals.length;
            const warningCount = summaryPayload.counts?.warning ?? warnings.length;
            const unknownCount = summaryPayload.counts?.unknown ?? unknowns.length;

            const allActiveIssues =
                summaryPayload.counts?.allActiveIssues ??
                summaryPayload.counts?.allServices ??
                criticalCount + warningCount + unknownCount;

            setCounts({
                allActiveIssues,
                critical: criticalCount,
                warning: warningCount,
                unknown: unknownCount
            });

            setServiceMeta(
                summaryPayload.meta || {
                    page: servicePage,
                    limit: serviceLimit,
                    total: summaryPayload.count || allReturnedServices.length || 0
                }
            );

            const normalizedHosts = rawHosts.map(normalizeHost);

            const uniquePollers = [
                ...new Set(
                    normalizedHosts
                        .map(h => h.poller_name)
                        .filter(Boolean)
                )
            ];

            setPollerDropdownList(uniquePollers);
            setLastUpdated(new Date().toLocaleTimeString());

        } catch (e) {
            console.error("Failed syncing infrastructure metrics:", e);
        } finally {
            if (!usingDashboardGlobalCache) {
                setIsLoadingServices(false);
            }
        }
    }, [
        location.pathname,
        filters.poller,
        debouncedHostSearch,
        debouncedServiceSearch,
        servicePage,
        serviceLimit,
        fetchGlobalDashboardSummary
    ]);

    // ============================================================
    // POLLERS FETCH
    // ============================================================
    const fetchPollersRoster = useCallback(async () => {
        try {
            const token = localStorage.getItem('centreon_auth_token');

            const response = await fetch(`${BASE_API_URL}/api/centreon/pollers`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error("Pollers endpoint failed:", response.status, errorText);
                throw new Error(`HTTP Error ${response.status}`);
            }

            const payload = await response.json();

            const rawPollers =
                payload.data?.result ||
                payload.result ||
                [];

            const mappedPollers = rawPollers.map(poller => ({
                Poller: poller.poller_name || `Poller ${poller.poller_id}`,
                poller_id: poller.poller_id,
                Address: poller.address || 'N/A',
                ServerType: poller.server_type || 'N/A',
                Total: poller.totalHosts ?? null,
                Critical: poller.downHosts ?? null,
                Warning: poller.pendingHosts ?? null,
                Unknown: poller.unreachableHosts ?? null,
                upHosts: poller.upHosts ?? null,
                downHosts: poller.downHosts ?? null,
                unreachableHosts: poller.unreachableHosts ?? null,
                pendingHosts: poller.pendingHosts ?? null
            }));

            setCachedPollers(mappedPollers);

            if (payload.meta?.hostCountRefreshing && !payload.meta?.hostCountLoaded) {
                setTimeout(() => {
                    fetchPollersRoster();
                }, 5000);
            }

        } catch (error) {
            console.error('Error fetching pollers roster:', error);
            setCachedPollers([]);
        }
    }, []);

    const fetchServicesForVisibleHosts = useCallback(async (hosts) => {
        try {
            setIsLoadingPollerServices(true);

            const token = localStorage.getItem('centreon_auth_token');

            const hostsWithIds = hosts
                .map(host => ({
                    host,
                    hostId: host.id ?? host.host_id
                }))
                .filter(item => item.hostId !== undefined && item.hostId !== null);

            if (hostsWithIds.length === 0) {
                setPollerServices([]);
                setPollerServiceCounts({
                    allActiveIssues: 0,
                    critical: 0,
                    warning: 0,
                    unknown: 0
                });
                return;
            }

            const results = await Promise.all(
                hostsWithIds.map(async ({ host, hostId }) => {
                    try {
                        const response = await fetch(`${BASE_API_URL}/api/centreon/services/host/${hostId}`, {
                            headers: {
                                'Authorization': `Bearer ${token}`
                            }
                        });

                        if (!response.ok) {
                            throw new Error(`HTTP Error ${response.status}`);
                        }

                        const payload = await response.json();

                        return (payload.data?.result || []).map(service => normalizeService({
                            ...service,
                            host: service.host || {
                                id: hostId,
                                name: host.name,
                                display_name: host.display_name,
                                alias: host.alias,
                                poller_id: host.poller_id,
                                poller_name: host.poller_name
                            }
                        }));

                    } catch (error) {
                        console.warn("Failed loading services for host:", hostId, error);
                        return [];
                    }
                })
            );

            const allServices = results.flat();

            const activeIssueServices = allServices.filter(service =>
                service.statusCode === 1 ||
                service.statusCode === 2 ||
                service.statusCode === 3
            );

            setPollerServices(activeIssueServices);
            setPollerServiceCounts(buildServiceCounts(activeIssueServices));

        } catch (error) {
            console.error("Error loading services for visible poller hosts:", error);
            setPollerServices([]);
            setPollerServiceCounts({
                allActiveIssues: 0,
                critical: 0,
                warning: 0,
                unknown: 0
            });
        } finally {
            setIsLoadingPollerServices(false);
        }
    }, []);

    const fetchPollerHosts = useCallback(async (pollerId, page = 1, limit = pollerHostLimit) => {
        try {
            if (!pollerId) return;

            setIsLoadingPollerHosts(true);
            setIsLoadingPollerServices(true);

            const token = localStorage.getItem('centreon_auth_token');

            const response = await fetch(
                `${BASE_API_URL}/api/centreon/pollers/${pollerId}/hosts?page=${page}&limit=${limit}`,
                {
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                }
            );

            if (!response.ok) {
                throw new Error(`HTTP Error ${response.status}`);
            }

            const payload = await response.json();

            const returnedHosts = payload.data?.result || [];

            setPollerHosts(returnedHosts);
            setPollerHostMeta(payload.meta || {
                page,
                limit,
                total: 0,
                totalPages: 1
            });

            if (payload.meta?.hostCacheRefreshing && !payload.meta?.hostCacheLoaded) {
                setPollerServices([]);
                setPollerServiceCounts({
                    allActiveIssues: null,
                    critical: null,
                    warning: null,
                    unknown: null
                });

                setTimeout(() => {
                    fetchPollerHosts(pollerId, page, limit);
                }, 5000);

                return;
            }

            if (returnedHosts.length > 0) {
                await fetchServicesForVisibleHosts(returnedHosts);
            } else {
                setPollerServices([]);
                setPollerServiceCounts({
                    allActiveIssues: 0,
                    critical: 0,
                    warning: 0,
                    unknown: 0
                });
                setIsLoadingPollerServices(false);
            }

        } catch (error) {
            console.error('Error fetching poller hosts:', error);
            setPollerServices([]);
            setPollerServiceCounts({
                allActiveIssues: 0,
                critical: 0,
                warning: 0,
                unknown: 0
            });
            setIsLoadingPollerServices(false);
        } finally {
            setIsLoadingPollerHosts(false);
        }
    }, [pollerHostLimit, fetchServicesForVisibleHosts]);

    // ============================================================
    // MANUAL REFRESH
    // ============================================================
    const handleGlobalManualRefresh = () => {
        const suppressSummaryCardUpdate =
            location.pathname === '/dashboard' &&
            filters.poller === 'all' &&
            Boolean(debouncedHostSearch || debouncedServiceSearch);

        refreshDashboardData();
        fetchGlobalDashboardSummary(!suppressSummaryCardUpdate);
        fetchPollersRoster();

        if (
            location.pathname === '/dashboard' &&
            filters.poller === 'all'
        ) {
            fetchDashboardGlobalServiceList(
                currentTableType,
                servicePage,
                serviceLimit,
                debouncedHostSearch,
                debouncedServiceSearch
            );
        }

        if (selectedPollerId) {
            fetchPollerHosts(selectedPollerId, pollerHostPage, pollerHostLimit);
        }
    };

    // ============================================================
    // LIFECYCLE
    // ============================================================
    useEffect(() => {
        if (!localStorage.getItem('centreon_auth_token')) {
            if (location.pathname !== '/logout' && location.pathname !== '/login') {
                navigate('/login');
            }
            return;
        }

        const suppressSummaryCardUpdate =
            location.pathname === '/dashboard' &&
            filters.poller === 'all' &&
            Boolean(debouncedHostSearch || debouncedServiceSearch);

        refreshDashboardData();
        fetchGlobalDashboardSummary(!suppressSummaryCardUpdate);
        fetchPollersRoster();

        const heartbeat = setInterval(() => {
            const heartbeatSuppressSummaryCardUpdate =
                location.pathname === '/dashboard' &&
                filters.poller === 'all' &&
                Boolean(debouncedHostSearch || debouncedServiceSearch);

            refreshDashboardData();
            fetchGlobalDashboardSummary(!heartbeatSuppressSummaryCardUpdate);
            fetchPollersRoster();

            if (selectedPollerId) {
                fetchPollerHosts(selectedPollerId, pollerHostPage, pollerHostLimit);
            }
        }, 300000);

        return () => clearInterval(heartbeat);
    }, [
        refreshDashboardData,
        fetchGlobalDashboardSummary,
        fetchPollersRoster,
        fetchPollerHosts,
        selectedPollerId,
        pollerHostPage,
        pollerHostLimit,
        location.pathname,
        filters.poller,
        debouncedHostSearch,
        debouncedServiceSearch,
        navigate
    ]);

    useEffect(() => {
        if (location.pathname === '/pollers' && selectedPollerId) {
            fetchPollerHosts(selectedPollerId, pollerHostPage, pollerHostLimit);
        }
    }, [location.pathname, selectedPollerId, pollerHostPage, pollerHostLimit, fetchPollerHosts]);

    // ============================================================
    // MEMOIZED DATA
    // ============================================================
    const activePollerContext = useMemo(() => {
        if (location.pathname === '/dashboard') return filters.poller;
        if (location.pathname === '/pollers') return selectedPoller || 'all';
        return 'all';
    }, [location.pathname, filters.poller, selectedPoller]);

    const dashboardGlobalListMode = useMemo(() => {
        return (
            location.pathname === '/dashboard' &&
            filters.poller === 'all'
        );
    }, [
        location.pathname,
        filters.poller
    ]);

    useEffect(() => {
        if (!dashboardGlobalListMode) {
            dashboardGlobalListRequestIdRef.current += 1;
            setIsLoadingDashboardGlobalList(false);
        }
    }, [dashboardGlobalListMode]);

    useEffect(() => {
        if (dashboardGlobalListMode) {
            fetchDashboardGlobalServiceList(
                currentTableType,
                servicePage,
                serviceLimit,
                debouncedHostSearch,
                debouncedServiceSearch
            );
        }
    }, [
        dashboardGlobalListMode,
        currentTableType,
        servicePage,
        serviceLimit,
        debouncedHostSearch,
        debouncedServiceSearch,
        fetchDashboardGlobalServiceList
    ]);

    const filteredPollers = useMemo(() => {
        const search = pollerSearch.toLowerCase().trim();

        return cachedPollers.filter(p =>
            !search ||
            p.Poller?.toLowerCase().includes(search) ||
            String(p.poller_id || '').includes(search)
        );
    }, [cachedPollers, pollerSearch]);

    const displayCounts = useMemo(() => {
        if (location.pathname === '/pollers' && selectedPollerId) {
            return pollerServiceCounts;
        }

        if (location.pathname === '/dashboard' && activePollerContext === 'all') {
            return {
                allActiveIssues: globalDashboardCounts.allActiveIssues ?? counts.allActiveIssues,
                critical: globalDashboardCounts.critical ?? counts.critical,
                warning: globalDashboardCounts.warning ?? counts.warning,
                unknown: globalDashboardCounts.unknown ?? counts.unknown
            };
        }

        if (activePollerContext !== 'all') {
            const critical = cachedCritical.filter(s => s.poller_name === activePollerContext).length;
            const warning = cachedWarning.filter(s => s.poller_name === activePollerContext).length;
            const unknown = cachedUnknown.filter(s => s.poller_name === activePollerContext).length;

            return {
                allActiveIssues: critical + warning + unknown,
                critical,
                warning,
                unknown
            };
        }

        return counts;
    }, [
        location.pathname,
        selectedPollerId,
        pollerServiceCounts,
        activePollerContext,
        globalDashboardCounts,
        counts,
        cachedCritical,
        cachedWarning,
        cachedUnknown
    ]);

    const isSearchMode = Boolean(debouncedHostSearch || debouncedServiceSearch);

    const filteredServices = useMemo(() => {
        let source = [];

        if (isSearchMode) {
            const activeIssueResults = cachedSearchResults.filter(item =>
                item.statusCode === 1 ||
                item.statusCode === 2 ||
                item.statusCode === 3
            );

            if (currentTableType === 'all') source = activeIssueResults;
            if (currentTableType === 'critical') source = activeIssueResults.filter(item => item.statusCode === 2);
            if (currentTableType === 'warning') source = activeIssueResults.filter(item => item.statusCode === 1);
            if (currentTableType === 'unknown') source = activeIssueResults.filter(item => item.statusCode === 3);
        } else if (showAllStatusesForPoller) {
            source = [...cachedCritical, ...cachedWarning, ...cachedUnknown];
        } else {
            if (currentTableType === 'all') source = [...cachedCritical, ...cachedWarning, ...cachedUnknown];
            if (currentTableType === 'critical') source = cachedCritical;
            if (currentTableType === 'warning') source = cachedWarning;
            if (currentTableType === 'unknown') source = cachedUnknown;
        }

        return source.filter(item => {
            const matchHost =
                !filters.host ||
                item.host?.name?.toLowerCase().includes(filters.host.toLowerCase()) ||
                item.host?.display_name?.toLowerCase().includes(filters.host.toLowerCase()) ||
                item.host?.alias?.toLowerCase().includes(filters.host.toLowerCase());

            const matchService =
                !filters.service ||
                item.description?.toLowerCase().includes(filters.service.toLowerCase()) ||
                item.display_name?.toLowerCase().includes(filters.service.toLowerCase());

            const matchPoller =
                filters.poller === 'all' ||
                item.poller_name === filters.poller;

            return matchHost && matchService && matchPoller;
        });
    }, [
        isSearchMode,
        showAllStatusesForPoller,
        currentTableType,
        cachedSearchResults,
        cachedCritical,
        cachedWarning,
        cachedUnknown,
        filters
    ]);

    const dashboardTableServices = useMemo(() => {
        if (dashboardGlobalListMode) {
            return dashboardGlobalServices;
        }

        return filteredServices;
    }, [
        dashboardGlobalListMode,
        dashboardGlobalServices,
        filteredServices
    ]);

    const filteredPollerServices = useMemo(() => {
        if (currentTableType === 'all') return pollerServices;
        if (currentTableType === 'critical') return pollerServices.filter(service => service.statusCode === 2);
        if (currentTableType === 'warning') return pollerServices.filter(service => service.statusCode === 1);
        if (currentTableType === 'unknown') return pollerServices.filter(service => service.statusCode === 3);
        return pollerServices;
    }, [pollerServices, currentTableType]);

    // ============================================================
    // PAGINATION HELPERS
    // ============================================================
    const totalPages = useMemo(() => {
        if (dashboardGlobalListMode) {
            return Math.max(1, dashboardGlobalMeta.totalPages || 1);
        }

        return Math.max(1, Math.ceil((serviceMeta.total || 0) / serviceLimit));
    }, [
        dashboardGlobalListMode,
        dashboardGlobalMeta.totalPages,
        serviceMeta.total,
        serviceLimit
    ]);

    const visiblePageNumbers = useMemo(() => {
        const pages = [];
        const start = Math.max(1, servicePage - 2);
        const end = Math.min(totalPages, servicePage + 2);

        for (let page = start; page <= end; page++) {
            pages.push(page);
        }

        return pages;
    }, [servicePage, totalPages]);

    const goToPage = (page) => {
        const safePage = Math.min(Math.max(page, 1), totalPages);
        setServicePage(safePage);
    };

    const handlePageSizeChange = (e) => {
        setServiceLimit(Number(e.target.value));
        setServicePage(1);
    };

    // ============================================================
    // ACKNOWLEDGMENT / LOGOUT
    // ============================================================
    const handleAcknowledge = async (hostName, serviceDescription, hostId = null, serviceId = null) => {
        try {
            const token = localStorage.getItem('centreon_auth_token');

            const response = await fetch(`${BASE_API_URL}/api/centreon/acknowledge`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    host: hostName,
                    service: serviceDescription,
                    hostId,
                    serviceId
                })
            });

            if (!response.ok) {
                throw new Error("Acknowledge network payload failed");
            }

            refreshDashboardData();

            if (dashboardGlobalListMode) {
                fetchDashboardGlobalServiceList(
                    currentTableType,
                    servicePage,
                    serviceLimit,
                    debouncedHostSearch,
                    debouncedServiceSearch
                );
            }

        } catch (error) {
            console.error("Failed to run safe exception acknowledgment:", error);
        }
    };

    const handleLogout = () => {
        localStorage.clear();
        navigate('/login');
    };

    return (
        <div className="app-container">
            <aside className="sidebar">
                <div className="logo">
                    <span className="logo-icon">📊</span>
                    <span className="logo-text">GOC Dashboard</span>
                </div>

                <nav className="nav-menu">
                    <Link to="/dashboard" className={`nav-item ${location.pathname === '/dashboard' ? 'active' : ''}`}>
                        <span className="nav-icon">📊</span>
                        <span className="nav-text">Dashboard</span>
                    </Link>

                    <Link to="/pollers" className={`nav-item ${location.pathname === '/pollers' ? 'active' : ''}`}>
                        <span className="nav-icon">📡</span>
                        <span className="nav-text">Pollers</span>
                    </Link>

                    <Link to="/logs" className={`nav-item ${location.pathname === '/logs' ? 'active' : ''}`}>
                        <span className="nav-icon">📋</span>
                        <span className="nav-text">Audit Logs</span>
                    </Link>
                </nav>

                <div className="sidebar-footer">
                    <div className="refresh-info">🔄 Sync: {lastUpdated}</div>

                    <button className="logout-btn-sidebar" onClick={handleLogout}>
                        <span className="logout-text">Sign Out</span>
                    </button>
                </div>
            </aside>

            <main className="main-content">
                <header className="content-header">
                    <h1>
                        {location.pathname === '/dashboard' && 'Dashboard Overview'}
                        {location.pathname === '/pollers' && 'Pollers Overview'}
                        {location.pathname === '/sla' && 'SLA Metrics'}
                        {location.pathname === '/logs' && 'System Audit Log'}
                    </h1>

                    <button className="refresh-btn" onClick={handleGlobalManualRefresh}>
                        Refresh Data
                    </button>
                </header>

                {(location.pathname === '/dashboard' || (location.pathname === '/pollers' && selectedPoller)) && (
                    <div className="stats-grid" style={{ marginBottom: '24px' }}>
                        <div
                            className={`stat-card all ${currentTableType === 'all' ? 'active' : ''}`}
                            onClick={() => {
                                setCurrentTableType('all');
                                if (location.pathname === '/dashboard') {
                                    setServicePage(1);
                                    setShowAllStatusesForPoller(true);
                                }
                            }}
                        >
                            <div className="stat-number">{displayCounts.allActiveIssues ?? '-'}</div>
                            <div className="stat-label">All Active Issues</div>
                        </div>

                        <div
                            className={`stat-card critical ${currentTableType === 'critical' ? 'active' : ''}`}
                            onClick={() => {
                                setCurrentTableType('critical');
                                if (location.pathname === '/dashboard') {
                                    setServicePage(1);
                                    setShowAllStatusesForPoller(false);
                                }
                            }}
                        >
                            <div className="stat-number">{displayCounts.critical ?? '-'}</div>
                            <div className="stat-label">Critical</div>
                        </div>

                        <div
                            className={`stat-card warning ${currentTableType === 'warning' ? 'active' : ''}`}
                            onClick={() => {
                                setCurrentTableType('warning');
                                if (location.pathname === '/dashboard') {
                                    setServicePage(1);
                                    setShowAllStatusesForPoller(false);
                                }
                            }}
                        >
                            <div className="stat-number">{displayCounts.warning ?? '-'}</div>
                            <div className="stat-label">Warning</div>
                        </div>

                        <div
                            className={`stat-card unknown ${currentTableType === 'unknown' ? 'active' : ''}`}
                            onClick={() => {
                                setCurrentTableType('unknown');
                                if (location.pathname === '/dashboard') {
                                    setServicePage(1);
                                    setShowAllStatusesForPoller(false);
                                }
                            }}
                        >
                            <div className="stat-number">{displayCounts.unknown ?? '-'}</div>
                            <div className="stat-label">Unknown</div>
                        </div>
                    </div>
                )}

                {location.pathname === '/dashboard' && (
                    <div className="page active">
                        <div className="top-row">
                            <div className="filter-section" style={{ width: '100%' }}>
                                <div className="filter-controls-vertical">
                                    <div className="filter-input-group">
                                        <label>HOST</label>
                                        <input
                                            type="text"
                                            className="filter-input"
                                            placeholder="Filter host..."
                                            value={filters.host}
                                            onChange={(e) => setFilters(f => ({ ...f, host: e.target.value }))}
                                        />
                                    </div>

                                    <div className="filter-input-group">
                                        <label>SERVICES</label>
                                        <input
                                            type="text"
                                            className="filter-input"
                                            placeholder="Filter service..."
                                            value={filters.service}
                                            onChange={(e) => setFilters(f => ({ ...f, service: e.target.value }))}
                                        />
                                    </div>

                                    <div className="filter-input-group">
                                        <label>POLLERS</label>
                                        <select
                                            className="filter-select"
                                            value={filters.poller}
                                            onChange={(e) => {
                                                setFilters(f => ({ ...f, poller: e.target.value }));
                                                setShowAllStatusesForPoller(false);
                                                setServicePage(1);
                                            }}
                                        >
                                            <option value="all">**NOT YET FUNCTIONING**</option>
                                            {pollerDropdownList.map(name => (
                                                <option key={name} value={name}>
                                                    {name}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="services-section">
                            <div className="section-header">
                                <div className="section-header-left">
                                    <h2 className="section-title">
                                        {isSearchMode ? 'Search Results' : 'Active Exceptions'}
                                    </h2>

                                    <span className="service-count">
                                        {
                                            dashboardGlobalListMode
                                                ? (
                                                    isLoadingDashboardGlobalList
                                                        ? 'Loading...'
                                                        : `${dashboardTableServices.length} of ${dashboardGlobalMeta.total || 0} Targets`
                                                )
                                                : (
                                                    isLoadingServices
                                                        ? 'Loading...'
                                                        : `${dashboardTableServices.length} Targets`
                                                )
                                        }

                                        {dashboardGlobalListMode && (
                                            <>
                                                {' '}| Global cache {isRefreshingGlobalSummary ? 'refreshing...' : 'cached'}
                                            </>
                                        )}
                                    </span>
                                </div>
                            </div>

                            <div className="table-wrapper">
                                <table className="services-table">
                                    <thead>
                                        <tr>
                                            <th>Host</th>
                                            <th>Service</th>
                                            <th>Output Summary</th>
                                            <th>Status</th>
                                            <th>Acknowledged</th>
                                        </tr>
                                    </thead>

                                    <tbody>
                                        {dashboardTableServices.length === 0 ? (
                                            <tr>
                                                <td colSpan="5" className="loading-cell">
                                                    {dashboardGlobalListMode
                                                        ? (
                                                            isLoadingDashboardGlobalList
                                                                ? 'Loading services...'
                                                                : 'No active issues found matching current criteria.'
                                                        )
                                                        : (
                                                            isLoadingServices
                                                                ? 'Loading services...'
                                                                : 'No active issues found matching current criteria.'
                                                        )}
                                                </td>
                                            </tr>
                                        ) : (
                                            dashboardTableServices.map((service, idx) => (
                                                <tr key={service.id || idx}>
                                                    <td className="host-name">
                                                        {service.host?.name || service.host?.display_name || 'N/A'}
                                                    </td>

                                                    <td className="service-name">
                                                        {service.description || service.display_name || 'N/A'}
                                                    </td>

                                                    <td className="service-output">
                                                        {service.output || 'No output details provided.'}
                                                    </td>

                                                    <td>
                                                        <span className={`status-text ${service.statusName?.toLowerCase()}`}>
                                                            {service.statusName}
                                                        </span>
                                                    </td>

                                                    <td className="ack-cell">
                                                        {service.is_acknowledged ? (
                                                            <span className="ack-badge">Acknowledged</span>
                                                        ) : (
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                <span className="pending-badge">Pending</span>

                                                                <button
                                                                    className="ack-btn"
                                                                    onClick={() => handleAcknowledge(
                                                                        service.host?.name,
                                                                        service.description,
                                                                        service.host?.id,
                                                                        service.id
                                                                    )}
                                                                    style={{
                                                                        background: '#238636',
                                                                        color: 'white',
                                                                        border: 'none',
                                                                        padding: '2px 8px',
                                                                        borderRadius: '4px',
                                                                        cursor: 'pointer',
                                                                        fontSize: '11px',
                                                                        fontWeight: 'bold'
                                                                    }}
                                                                >
                                                                    Ack
                                                                </button>
                                                            </div>
                                                        )}
                                                    </td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>

                            <div
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    gap: '16px',
                                    marginTop: '16px',
                                    flexWrap: 'wrap'
                                }}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <span>Page size:</span>
                                    <select
                                        className="filter-select"
                                        value={serviceLimit}
                                        onChange={handlePageSizeChange}
                                        disabled={isLoadingServices || (dashboardGlobalListMode && isLoadingDashboardGlobalList)}
                                        style={{ width: '100px' }}
                                    >
                                        <option value={50}>50</option>
                                        <option value={100}>100</option>
                                        <option value={250}>250</option>
                                        <option value={500}>500</option>
                                    </select>
                                </div>

                                <div>
                                    Page {servicePage} of {totalPages}
                                    {' '}| Total Services: {dashboardGlobalListMode ? (dashboardGlobalMeta.total || 0) : (serviceMeta.total || 0)}
                                </div>

                                <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                                    <button
                                        className="refresh-btn"
                                        disabled={servicePage <= 1 || isLoadingServices || (dashboardGlobalListMode && isLoadingDashboardGlobalList)}
                                        onClick={() => goToPage(1)}
                                    >
                                        First
                                    </button>

                                    <button
                                        className="refresh-btn"
                                        disabled={servicePage <= 1 || isLoadingServices || (dashboardGlobalListMode && isLoadingDashboardGlobalList)}
                                        onClick={() => goToPage(servicePage - 1)}
                                    >
                                        Previous
                                    </button>

                                    {visiblePageNumbers.map(page => (
                                        <button
                                            key={page}
                                            className="refresh-btn"
                                            disabled={isLoadingServices || (dashboardGlobalListMode && isLoadingDashboardGlobalList)}
                                            onClick={() => goToPage(page)}
                                            style={{
                                                backgroundColor: page === servicePage ? '#238636' : undefined,
                                                color: page === servicePage ? 'white' : undefined
                                            }}
                                        >
                                            {page}
                                        </button>
                                    ))}

                                    <button
                                        className="refresh-btn"
                                        disabled={servicePage >= totalPages || isLoadingServices || (dashboardGlobalListMode && isLoadingDashboardGlobalList)}
                                        onClick={() => goToPage(servicePage + 1)}
                                    >
                                        Next
                                    </button>

                                    <button
                                        className="refresh-btn"
                                        disabled={servicePage >= totalPages || isLoadingServices || (dashboardGlobalListMode && isLoadingDashboardGlobalList)}
                                        onClick={() => goToPage(totalPages)}
                                    >
                                        Last
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {location.pathname === '/pollers' && (
                    <div className="page active">
                        <div className="pollers-container">
                            {!selectedPoller ? (
                                <>
                                    <div className="pollers-header">
                                        <h2>Engine Node Assignments</h2>

                                        <div className="search-bar">
                                            <input
                                                type="text"
                                                className="search-input"
                                                placeholder="Filter pollers by name or ID..."
                                                value={pollerSearch}
                                                onChange={(e) => setPollerSearch(e.target.value)}
                                            />
                                        </div>
                                    </div>

                                    <div className="pollers-table-wrapper">
                                        <table className="pollers-table">
                                            <thead>
                                                <tr>
                                                    <th>Poller</th>
                                                    <th>Address</th>
                                                    <th>Server Type</th>
                                                    <th>Total Hosts</th>
                                                    <th>UP</th>
                                                    <th>DOWN</th>
                                                    <th>UNREACHABLE</th>
                                                    <th>PENDING</th>
                                                </tr>
                                            </thead>

                                            <tbody>
                                                {filteredPollers.length === 0 ? (
                                                    <tr>
                                                        <td colSpan="8" className="loading-cell">
                                                            No poller found matching search parameters.
                                                        </td>
                                                    </tr>
                                                ) : (
                                                    filteredPollers.map((p, idx) => (
                                                        <tr key={p.poller_id || idx}>
                                                            <td
                                                                className="poller-name"
                                                                style={{ cursor: 'pointer', color: '#58a6ff' }}
                                                                onClick={() => {
                                                                    setSelectedPoller(p.Poller);
                                                                    setSelectedPollerId(p.poller_id);

                                                                    setCurrentTableType('all');
                                                                    setPollerHostPage(1);

                                                                    setPollerHosts([]);
                                                                    setPollerServices([]);
                                                                    setPollerServiceCounts({
                                                                        allActiveIssues: null,
                                                                        critical: null,
                                                                        warning: null,
                                                                        unknown: null
                                                                    });

                                                                    fetchPollerHosts(p.poller_id, 1, pollerHostLimit);
                                                                }}
                                                            >
                                                                {p.Poller || `Poller ${p.poller_id}`}
                                                            </td>

                                                            <td className="address">{p.Address || 'N/A'}</td>
                                                            <td className="server-type">{p.ServerType || 'N/A'}</td>
                                                            <td className="total-count">{p.Total ?? '-'}</td>
                                                            <td style={{ color: '#3fb950', fontWeight: 'bold' }}>{p.upHosts ?? '-'}</td>
                                                            <td className="critical-count">{p.downHosts ?? '-'}</td>
                                                            <td className="warning-count">{p.unreachableHosts ?? '-'}</td>
                                                            <td style={{ color: '#8b949e', fontWeight: 'bold' }}>{p.pendingHosts ?? '-'}</td>
                                                        </tr>
                                                    ))
                                                )}
                                            </tbody>
                                        </table>
                                    </div>

                                    <div className="table-count">
                                        Total Monitored Pollers: {filteredPollers.length}
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div className="pollers-header">
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
                                            <button
                                                className="refresh-btn"
                                                onClick={() => {
                                                    setSelectedPoller(null);
                                                    setSelectedPollerId(null);

                                                    setPollerHosts([]);
                                                    setPollerServices([]);

                                                    setPollerServiceCounts({
                                                        allActiveIssues: null,
                                                        critical: null,
                                                        warning: null,
                                                        unknown: null
                                                    });

                                                    setCurrentTableType('all');
                                                }}
                                                style={{ backgroundColor: '#21262d', color: '#c9d1d9' }}
                                            >
                                                ⬅ Back to Pollers List
                                            </button>

                                            <h2>
                                                Poller: <span style={{ color: '#58a6ff' }}>{selectedPoller}</span>
                                            </h2>
                                        </div>

                                        <span className="service-count">
                                            Active services from current host page
                                        </span>
                                    </div>

                                    <div className="table-wrapper">
                                        <table className="services-table">
                                            <thead>
                                                <tr>
                                                    <th>Host</th>
                                                    <th>Service</th>
                                                    <th>Output Summary</th>
                                                    <th>Status</th>
                                                    <th>Acknowledged</th>
                                                </tr>
                                            </thead>

                                            <tbody>
                                                {isLoadingPollerHosts ? (
                                                    <tr>
                                                        <td colSpan="5" className="loading-cell">
                                                            Loading hosts for {selectedPoller}...
                                                        </td>
                                                    </tr>
                                                ) : isLoadingPollerServices ? (
                                                    <tr>
                                                        <td colSpan="5" className="loading-cell">
                                                            Loading active services for visible hosts...
                                                        </td>
                                                    </tr>
                                                ) : filteredPollerServices.length === 0 ? (
                                                    <tr>
                                                        <td colSpan="5" className="loading-cell">
                                                            No active Critical, Warning, or Unknown services found for this host page.
                                                        </td>
                                                    </tr>
                                                ) : (
                                                    filteredPollerServices.map((service, idx) => (
                                                        <tr key={service.id || idx}>
                                                            <td className="host-name">
                                                                {service.host?.name || service.host?.display_name || 'N/A'}
                                                            </td>

                                                            <td className="service-name">
                                                                {service.description || service.display_name || 'N/A'}
                                                            </td>

                                                            <td className="service-output">
                                                                {service.output || 'No output details provided.'}
                                                            </td>

                                                            <td>
                                                                <span className={`status-text ${service.statusName?.toLowerCase()}`}>
                                                                    {service.statusName}
                                                                </span>
                                                            </td>

                                                            <td className="ack-cell">
                                                                {service.is_acknowledged ? (
                                                                    <span className="ack-badge">Acknowledged</span>
                                                                ) : (
                                                                    <span className="pending-badge">Pending</span>
                                                                )}
                                                            </td>
                                                        </tr>
                                                    ))
                                                )}
                                            </tbody>
                                        </table>
                                    </div>

                                    <div
                                        style={{
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            alignItems: 'center',
                                            padding: '12px 20px',
                                            borderTop: '1px solid #30363d',
                                            flexWrap: 'wrap',
                                            gap: '12px'
                                        }}
                                    >
                                        <div className="table-count" style={{ padding: 0, borderTop: 'none' }}>
                                            Host Page: {pollerHostMeta.page || pollerHostPage} of {pollerHostMeta.totalPages || 1}
                                            {' '}| Hosts: {pollerHostMeta.total || 0}
                                            {' '}| Active Services Loaded: {pollerServices.length}
                                        </div>

                                        <div style={{ display: 'flex', gap: '8px' }}>
                                            <button
                                                className="refresh-btn"
                                                disabled={pollerHostPage <= 1 || isLoadingPollerHosts || isLoadingPollerServices}
                                                onClick={() => {
                                                    setPollerHostPage(prev => Math.max(prev - 1, 1));
                                                    setCurrentTableType('all');
                                                }}
                                            >
                                                Previous
                                            </button>

                                            <button
                                                className="refresh-btn"
                                                disabled={pollerHostPage >= (pollerHostMeta.totalPages || 1) || isLoadingPollerHosts || isLoadingPollerServices}
                                                onClick={() => {
                                                    setPollerHostPage(prev => prev + 1);
                                                    setCurrentTableType('all');
                                                }}
                                            >
                                                Next
                                            </button>
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                )}

                {location.pathname === '/sla' && <Sla />}
                {location.pathname === '/logs' && <Logs />}
            </main>
        </div>
    );
}