import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import '../Logout.css';

export default function Logout() {
    const navigate = useNavigate(); // 👈 Added this for automated navigation

    useEffect(() => {
        // 1. Clear all stored auth data immediately when the screen mounts
        localStorage.removeItem('centreon_auth_token');
        localStorage.removeItem('centreon_user');
        localStorage.removeItem('centreon_expires');
        
        // Alternative shortcut to completely wipe the slate clean:
        // localStorage.clear();

        // 2. Automated Redirect: Wait 1.5 seconds so they see the logout message, then bounce to login
        const timer = setTimeout(() => {
            navigate('/login');
        }, 1500);

        return () => clearTimeout(timer); // Clean up the timer if component unmounts
    }, [navigate]);

    return (
        <div className="logout-container">
            <div className="logout-card">
                <span className="logout-icon">👋</span>
                <div className="logout-title">Securing Session</div>
                <div className="logout-message">Clearing corporate profile and redirecting you to login...</div>
                
                {/* Visual loading indicator or spinner can go here */}
                <div className="loading-dots">...</div>
            </div>
        </div>
    );
}