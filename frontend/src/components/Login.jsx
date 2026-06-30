// frontend/src/components/Login.jsx
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import '../Login.css';

// 🎯 Dynamically read from the frontend .env file, fallback cleanly to port 5000
const BASE_API_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';

export default function Login() {
    const navigate = useNavigate();
    
    // --- FORM STATES ---
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');

    // --- AUTO-LOGIN GUARD ---
    useEffect(() => {
        const token = localStorage.getItem('centreon_auth_token');
        const expires = localStorage.getItem('centreon_expires');
        
        if (token && expires && parseInt(expires) > Date.now()) {
            navigate('/dashboard');
        } else {
            localStorage.clear();
        }
    }, [navigate]);

    // --- SUBMIT HANDLER ---
    const handleLoginSubmit = async (e) => {
        e.preventDefault();
        setIsLoading(true);
        setErrorMessage('');

        try {
            // 🚀 Hitting the unified Node API endpoint
            const response = await fetch(`${BASE_API_URL}/api/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            const data = await response.json();

            if (response.ok && data.success) {
                // Save token metrics received from server
                localStorage.setItem('centreon_auth_token', data.token);
                localStorage.setItem('centreon_user', username);
                localStorage.setItem('centreon_expires', data.expires.toString());
                
                // Route seamlessly into the platform
                navigate('/dashboard');
            } else {
                setErrorMessage(data.message || 'Invalid username or password');
            }
        } catch (error) {
            console.error('Login connection error:', error);

            // 💡 OFFLINE LAPTOP FALLBACK DEV RULE
            // If your Node server isn't running on your laptop right now, this block catches the 
            // connection error and lets you bypass it seamlessly using your mock testing credentials!
            if (username === 'admin' && password === 'goc123') {
                console.warn('Backend server unreachable. Falling back to local sandbox profile.');
                
                localStorage.setItem('centreon_auth_token', 'mock-local-secure-token');
                localStorage.setItem('centreon_user', username);
                localStorage.setItem('centreon_expires', (Date.now() + 2 * 60 * 60 * 1000).toString());
                
                navigate('/dashboard');
            } else {
                setErrorMessage('Cannot connect to backend server. For offline testing, use admin / goc123');
            }
        } finally {
            // Ensure loading stops regardless of path outcome
            setIsLoading(false);
        }
    };

    return (
        <div className="login-container">
            <div className="login-card">
                <div className="login-logo">
                    <span className="logo-icon">📊</span>
                    <span className="logo-text">GOC Centreon Dashboard</span>
                    <span className="logo-sub">Service Status Monitoring</span>
                </div>

                {errorMessage && (
                    <div className="error-message">
                        ❌ {errorMessage}
                    </div>
                )}

                <form onSubmit={handleLoginSubmit}>
                    <div className="form-group">
                        <label htmlFor="username">Username</label>
                        <input 
                            type="text" 
                            id="username" 
                            placeholder="Enter your Centreon username" 
                            required 
                            autoComplete="username"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                        />
                    </div>

                    <div className="form-group">
                        <label htmlFor="password">Password</label>
                        <input 
                            type="password" 
                            id="password" 
                            placeholder="Enter your Centreon password" 
                            required 
                            autoComplete="current-password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                        />
                    </div>

                    <button 
                        type="submit" 
                        className="login-btn" 
                        disabled={isLoading}
                    >
                        {isLoading ? 'Signing in...' : 'Sign In'}
                    </button>
                </form>

                <div className="info-message">
                    Use your Centreon credentials to login
                </div>
            </div>
        </div>
    );
}