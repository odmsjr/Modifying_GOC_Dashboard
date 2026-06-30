import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import "../Pollers.css";

// 🎯 Pull securely from Vite .env environment variables (Fallback to local Express port 5000)
const BASE_API_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';

export default function Pollers() {
    const navigate = useNavigate();

    // --- STATE MANAGEMENT ---
    const [pollers, setPollers] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState("");
    const [statusFilter, setStatusFilter] = useState("all"); // 'all', 'critical', 'warning', 'unknown'
    const [currentPage, setCurrentPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);

    // ============================================================
    // CONNECTED FETCH ENGINE (Real-Time Aggregate Matrix)
    // ============================================================
    const fetchPollersData = useCallback(async () => {
        setIsLoading(true);
        try {
            const token = localStorage.getItem('centreon_auth_token');
            const response = await fetch(`${BASE_API_URL}/api/centreon/services`, {
                headers: { 
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) throw new Error(`HTTP Error Status: ${response.status}`);
            
            const payload = await response.json();
            const rawServices = payload.data?.result || [];

            // 📊 AGGREGATION BLOCK: Transform raw exceptions into an engine node state grid
            const pollerMap = {};
            
            rawServices.forEach(item => {
                const pName = item.poller_name || 'Default Poller';
                
                if (!pollerMap[pName]) {
                    pollerMap[pName] = { 
                        id: pName, 
                        name: pName, 
                        critical: 0, 
                        warning: 0, 
                        unknown: 0, 
                        total: 0 
                    };
                }

                // Map status counts dynamically based on live infrastructure updates
                if (item.status === 'CRITICAL') pollerMap[pName].critical++;
                if (item.status === 'WARNING') pollerMap[pName].warning++;
                if (item.status === 'UNKNOWN') pollerMap[pName].unknown++;
                pollerMap[pName].total++;
            });

            setPollers(Object.values(pollerMap));
        } catch (error) {
            console.error("Failed calculating real-time poller state matrix:", error);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchPollersData();
        
        // Background sync heartbeat every 30 seconds to keep live metrics accurate
        const interval = setInterval(fetchPollersData, 30000);
        return () => clearInterval(interval);
    }, [fetchPollersData]);

    // ============================================================
    // INTERACTIVE ROUTING CONTROLLER
    // ============================================================
    const jumpToDashboardWithFilter = (pollerName, statusType) => {
        navigate('/dashboard', { 
            state: { 
                poller: pollerName, 
                type: statusType 
            } 
        });
    };

    // --- COMPUTED LIVE METRICS (For Stats Cards) ---
    const metrics = useMemo(() => {
        return pollers.reduce((acc, poller) => {
            acc.critical += poller.critical;
            acc.warning += poller.warning;
            acc.unknown += poller.unknown;
            acc.totalIssues += poller.total;
            return acc;
        }, { critical: 0, warning: 0, unknown: 0, totalIssues: 0 });
    }, [pollers]);

    // --- FILTERING & SEARCH LOGIC ---
    const filteredPollers = useMemo(() => {
        return pollers.filter(poller => {
            const matchesSearch = poller.name?.toLowerCase().includes(searchTerm.toLowerCase());
            
            if (statusFilter === "critical") return matchesSearch && poller.critical > 0;
            if (statusFilter === "warning") return matchesSearch && poller.warning > 0;
            if (statusFilter === "unknown") return matchesSearch && poller.unknown > 0;
            return matchesSearch;
        });
    }, [pollers, searchTerm, statusFilter]);

    // --- PAGINATION LOGIC ---
    const totalPages = Math.ceil(filteredPollers.length / pageSize) || 1;
    
    useEffect(() => {
        setCurrentPage(1);
    }, [searchTerm, statusFilter, pageSize]);

    const paginatedPollers = useMemo(() => {
        const startIndex = (currentPage - 1) * pageSize;
        return filteredPollers.slice(startIndex, startIndex + pageSize);
    }, [filteredPollers, currentPage, pageSize]);

    return (
        <div className="pollers-container">
            <div className="pollers-header">
                <div className="header-top-row">
                    <h2>Poller Status Summary</h2>
                    <button className="refresh-btn-small" onClick={fetchPollersData} disabled={isLoading}>
                        {isLoading ? "🔄 Loading..." : "🔄 Refresh"}
                    </button>
                </div>
                
                {/* Stats Summary Cards */}
                <div className="poller-stats-summary">
                    <div 
                        className={`stat-summary-card critical ${statusFilter === 'critical' ? 'active-filter' : ''}`} 
                        onClick={() => setStatusFilter(statusFilter === 'critical' ? 'all' : 'critical')}
                    >
                        <div className="stat-label">TOTAL CRITICAL</div>
                        <div className="stat-value">{isLoading ? "--" : metrics.critical}</div>
                    </div>
                    <div 
                        className={`stat-summary-card warning ${statusFilter === 'warning' ? 'active-filter' : ''}`} 
                        onClick={() => setStatusFilter(statusFilter === 'warning' ? 'all' : 'warning')}
                    >
                        <div className="stat-label">TOTAL WARNING</div>
                        <div className="stat-value">{isLoading ? "--" : metrics.warning}</div>
                    </div>
                    <div 
                        className={`stat-summary-card unknown ${statusFilter === 'unknown' ? 'active-filter' : ''}`} 
                        onClick={() => setStatusFilter(statusFilter === 'unknown' ? 'all' : 'unknown')}
                    >
                        <div className="stat-label">TOTAL UNKNOWN</div>
                        <div className="stat-value">{isLoading ? "--" : metrics.unknown}</div>
                    </div>
                    <div 
                        className={`stat-summary-card total ${statusFilter === 'all' ? 'active-filter' : ''}`} 
                        onClick={() => setStatusFilter('all')}
                    >
                        <div className="stat-label">TOTAL ISSUES</div>
                        <div className="stat-value">{isLoading ? "--" : metrics.totalIssues}</div>
                    </div>
                </div>
                
                {/* Search and Pagination Controls */}
                <div className="search-pagination-row">
                    <div className="search-bar">
                        <input 
                            type="text" 
                            className="search-input" 
                            placeholder="🔍 Search by poller name..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                    <div className="pagination-controls">
                        <span className="pagination-label">Show:</span>
                        <select 
                            className="page-size-select"
                            value={pageSize}
                            onChange={(e) => setPageSize(Number(e.target.value))}
                        >
                            <option value="10">10</option>
                            <option value="20">20</option>
                            <option value="30">30</option>
                            <option value="50">50</option>
                            <option value="999999">All</option>
                        </select>
                        <div className="pagination-buttons">
                            <button 
                                className="page-btn" 
                                disabled={currentPage === 1 || isLoading} 
                                onClick={() => setCurrentPage(p => p - 1)}
                            >
                                ◀ Prev
                            </button>
                            <span className="page-info">
                                Page {currentPage} of {totalPages}
                            </span>
                            <button 
                                className="page-btn" 
                                disabled={currentPage === totalPages || isLoading} 
                                onClick={() => setCurrentPage(p => p + 1)}
                            >
                                Next ▶
                            </button>
                        </div>
                    </div>
                </div>
            </div>
            
            {/* Pollers Data Matrix */}
            <div className="pollers-table-wrapper">
                <table className="pollers-table">
                    <thead>
                        <tr>
                            <th>Poller Name</th>
                            <th>Critical</th>
                            <th>Warning</th>
                            <th>Unknown</th>
                            <th>Total Exceptions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {isLoading && pollers.length === 0 ? (
                            <tr>
                                <td colSpan="5" className="loading-cell">Syncing engine nodes from core backend...</td>
                            </tr>
                        ) : paginatedPollers.length === 0 ? (
                            <tr>
                                <td colSpan="5" className="loading-cell">No operational poller nodes match the selection filters.</td>
                            </tr>
                        ) : (
                            paginatedPollers.map((poller) => (
                                <tr key={poller.id} className="poller-interactive-row">
                                    {/* Clicking the Name jumps to the dashboard with ALL exceptions for this engine */}
                                    <td className="poller-name-cell" onClick={() => jumpToDashboardWithFilter(poller.name, 'all')}>
                                        🖥️ {poller.name}
                                    </td>
                                    
                                    {/* Clicking specific metric cells filters the dashboard straight to that exception type */}
                                    <td className={poller.critical > 0 ? "text-critical clickable" : "clickable"} onClick={() => jumpToDashboardWithFilter(poller.name, 'critical')}>
                                        {poller.critical}
                                    </td>
                                    <td className={poller.warning > 0 ? "text-warning clickable" : "clickable"} onClick={() => jumpToDashboardWithFilter(poller.name, 'warning')}>
                                        {poller.warning}
                                    </td>
                                    <td className={poller.unknown > 0 ? "text-unknown clickable" : "clickable"} onClick={() => jumpToDashboardWithFilter(poller.name, 'unknown')}>
                                        {poller.unknown}
                                    </td>
                                    
                                    <td className="text-bold clickable" onClick={() => jumpToDashboardWithFilter(poller.name, 'all')}>
                                        {poller.total}
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
            <div className="table-count">
                Showing {paginatedPollers.length} of {filteredPollers.length} active engine paths
            </div>
        </div>
    );
}