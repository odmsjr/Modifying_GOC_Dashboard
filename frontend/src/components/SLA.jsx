import React, { useState, useEffect, useMemo } from 'react';
import "../SLA.css";

const API_URL = window.API_URL || '';

export default function Sla() {
    // --- STATE MANAGEMENT ---
    const [isLoading, setIsLoading] = useState(true);
    const [lastUpdate, setLastUpdate] = useState('--');
    const [slaRecords, setSlaRecords] = useState([]);

    // Filter Controls Form States
    const [fromDate, setFromDate] = useState('');
    const [toDate, setToDate] = useState('');
    const [submissionView, setSubmissionView] = useState('latest');
    const [assignedTo, setAssignedTo] = useState('all');
    const [ticketId, setTicketId] = useState('');
    const [breached, setBreached] = useState('all');

    // Applied States to trigger API/Data recalculations
    const [appliedFilters, setAppliedFilters] = useState({
        fromDate: '',
        toDate: '',
        submissionView: 'latest',
        assignedTo: 'all',
        ticketId: '',
        breached: 'all'
    });

    // --- MOCK DATA LOADING ---
    useEffect(() => {
        setIsLoading(true);
        // Replace with live server ingestion: fetch(`${API_URL}/api/sla`)
        setTimeout(() => {
            const mockSlaData = [
                { id: 1, engineer: "Alex Mercer", avgMtr: 2.4, avgMtta: 0.15, created: 45, reopened: 1, resolved: 44, sla: 97.8, ticketId: "INC002415" },
                { id: 2, engineer: "Sarah Connor", avgMtr: 1.8, avgMtta: 0.08, created: 52, reopened: 0, resolved: 52, sla: 100.0, ticketId: "INC002489" },
                { id: 3, engineer: "David Lightman", avgMtr: 4.1, avgMtta: 0.52, created: 38, reopened: 3, resolved: 32, sla: 84.2, ticketId: "INC002512" },
                { id: 4, engineer: "Elena Rostova", avgMtr: 2.1, avgMtta: 0.11, created: 61, reopened: 1, resolved: 60, sla: 98.3, ticketId: "INC002560" }
            ];
            setSlaRecords(mockSlaData);
            setLastUpdate(new Date().toLocaleTimeString());
            setIsLoading(false);
        }, 500);
    }, [appliedFilters]);

    // --- DYNAMIC UNIQUE ENGINEERS LIST ---
    const engineersList = useMemo(() => {
        const names = slaRecords.map(item => item.engineer);
        return ['all', ...new Set(names)];
    }, [slaRecords]);

    // --- APPLY / CLEAR ACTION CONTROLS ---
    const handleApplyAllFilters = () => {
        setAppliedFilters({
            fromDate,
            toDate,
            submissionView,
            assignedTo,
            ticketId,
            breached
        });
    };

    const handleClearAllFilters = () => {
        setFromDate('');
        setToDate('');
        setSubmissionView('latest');
        setAssignedTo('all');
        setTicketId('');
        setBreached('all');
        setAppliedFilters({
            fromDate: '',
            toDate: '',
            submissionView: 'latest',
            assignedTo: 'all',
            ticketId: '',
            breached: 'all'
        });
    };

    // --- CLIENT SIDE SEARCH & FILTER MATRIX COMPILATION ---
    const processedRecords = useMemo(() => {
        return slaRecords.filter(item => {
            // Assigned To Filter
            if (appliedFilters.assignedTo !== 'all' && item.engineer !== appliedFilters.assignedTo) return false;
            
            // Ticket ID Search Filter
            if (appliedFilters.ticketId && !item.ticketId.toLowerCase().includes(appliedFilters.ticketId.toLowerCase())) return false;
            
            // Breached Filter logic (e.g., SLA below 95% threshold constitutes a breach scenario)
            if (appliedFilters.breached === 'yes' && item.sla >= 95) return false;
            if (appliedFilters.breached === 'no' && item.sla < 95) return false;

            return true;
        });
    }, [slaRecords, appliedFilters]);

    // --- COMPUTED SCOREBOARD SUMMARY METRICS ---
    const metrics = useMemo(() => {
        if (processedRecords.length === 0) return { totalRecords: 0, submissions: 0, overallSla: '0.0%' };
        
        const totalCreated = processedRecords.reduce((sum, item) => sum + item.created, 0);
        const totalResolved = processedRecords.reduce((sum, item) => sum + item.resolved, 0);
        const sumSla = processedRecords.reduce((sum, item) => sum + item.sla, 0);
        
        const overallPct = (sumSla / processedRecords.length).toFixed(1);

        return {
            totalRecords: totalCreated,
            submissions: processedRecords.length,
            overallSla: `${overallPct}%`
        };
    }, [processedRecords]);

    return (
        <div className="sla-container">
            <div className="sla-header">
                <div className="header-top-row">
                    <h2>📊 Ceva Monitoring SLA</h2>
                    <div>
                        <span className="last-update-badge">Last update: {lastUpdate}</span>
                    </div>
                </div>
                
                {/* Scoreboard Metrics Panels */}
                <div className="sla-stats-summary">
                    <div className="stat-summary-card total-records">
                        <div className="stat-label">Total Records</div>
                        <div className="stat-value">{isLoading ? '--' : metrics.totalRecords}</div>
                    </div>
                    <div className="stat-summary-card submissions">
                        <div className="stat-label">Submissions</div>
                        <div className="stat-value">{isLoading ? '--' : metrics.submissions}</div>
                    </div>
                    <div className="stat-summary-card overall-sla">
                        <div className="stat-label">Overall SLA</div>
                        <div className="stat-value">{isLoading ? '--' : metrics.overallSla}</div>
                    </div>
                </div>
                
                {/* Standard Base Filters Row */}
                <div className="sla-filter-row">
                    <div className="date-filters">
                        <label htmlFor="fromDateFilter">From:</label>
                        <input 
                            type="date" 
                            id="fromDateFilter" 
                            className="date-filter-input"
                            value={fromDate}
                            onChange={(e) => setFromDate(e.target.value)}
                        />
                        <label htmlFor="toDateFilter">To:</label>
                        <input 
                            type="date" 
                            id="toDateFilter" 
                            className="date-filter-input"
                            value={toDate}
                            onChange={(e) => setToDate(e.target.value)}
                        />
                    </div>
                    <div className="submission-selector">
                        <label htmlFor="submissionSelect">View Submission:</label>
                        <select 
                            id="submissionSelect" 
                            className="submission-select"
                            value={submissionView}
                            onChange={(e) => setSubmissionView(e.target.value)}
                        >
                            <option value="latest">Latest</option>
                            <option value="all">All Submissions</option>
                        </select>
                    </div>
                </div>
                
                {/* Advanced Operations Filter Row */}
                <div className="sla-extra-filters">
                    <div className="filter-group">
                        <label htmlFor="assignedToFilter">Assigned To:</label>
                        <select 
                            id="assignedToFilter" 
                            className="filter-select-small"
                            value={assignedTo}
                            onChange={(e) => setAssignedTo(e.target.value)}
                        >
                            {engineersList.map((name, i) => (
                                <option key={i} value={name}>
                                    {name === 'all' ? 'All Personnel' : name}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className="filter-group">
                        <label htmlFor="ticketIdFilter">Ticket ID:</label>
                        <input 
                            type="text" 
                            id="ticketIdFilter" 
                            className="filter-input-small" 
                            placeholder="Search ticket ID..."
                            value={ticketId}
                            onChange={(e) => setTicketId(e.target.value)}
                        />
                    </div>
                    <div className="filter-group">
                        <label htmlFor="breachedFilter">Breached:</label>
                        <select 
                            id="breachedFilter" 
                            className="filter-select-small"
                            value={breached}
                            onChange={(e) => setBreached(e.target.value)}
                        >
                            <option value="all">All Statuses</option>
                            <option value="yes">Yes (Below Target)</option>
                            <option value="no">No (Passing)</option>
                        </select>
                    </div>
                    <div className="action-buttons-wrapper">
                        <button className="filter-btn apply-filters-btn" onClick={handleApplyAllFilters}>Apply Filters</button>
                        <button className="filter-btn clear-filters-btn" onClick={handleClearAllFilters}>Clear Filters</button>
                    </div>
                </div>
            </div>
            
            {/* Core Matrix Analytics Table */}
            <div className="sla-table-wrapper">
                <table className="sla-table">
                    <thead>
                        <tr>
                            <th>Assigned To</th>
                            <th>Avg Mtr Hours</th>
                            <th>Avg Mtta Hours</th>
                            <th>Created Tickets</th>
                            <th>Reopened Tickets</th>
                            <th>Resolved Tickets</th>
                            <th>SLA Percentage</th>
                        </tr>
                    </thead>
                    <tbody>
                        {isLoading ? (
                            <tr>
                                <td colSpan="7" className="loading-cell">Loading SLA metrics data matrix...</td>
                            </tr>
                        ) : processedRecords.length === 0 ? (
                            <tr>
                                <td colSpan="7" className="loading-cell">No infrastructure SLA entries found matching criteria.</td>
                            </tr>
                        ) : (
                            processedRecords.map((record) => (
                                <tr key={record.id}>
                                    <td className="engineer-cell">👤 {record.engineer}</td>
                                    <td>{record.avgMtr}h</td>
                                    <td>{record.avgMtta}h</td>
                                    <td>{record.created}</td>
                                    <td className={record.reopened > 1 ? "text-warning" : ""}>{record.reopened}</td>
                                    <td>{record.resolved}</td>
                                    <td className={`text-bold ${record.sla >= 95 ? "text-success" : "text-critical"}`}>
                                        {record.sla.toFixed(1)}%
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
            <div className="table-count">
                {isLoading ? "Loading..." : `Showing ${processedRecords.length} profile summaries`}
            </div>
        </div>
    );
}