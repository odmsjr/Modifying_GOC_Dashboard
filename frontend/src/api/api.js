// src/api.js

// Point this to your backend server during local testing. 
// If your backend is running on port 3306, set it here.
const API_URL = window.API_URL || 'http://localhost:3306'; 

// Master authenticated fetch wrapper
export function authFetch(url, options = {}) {
    const token = localStorage.getItem('centreon_auth_token');
    return fetch(url, {
        ...options,
        headers: { 
            ...options.headers, 
            'Content-Type': 'application/json', 
            // 💡 Centreon corporate standard header is usually X-Auth-Token or Authorization.
            // Keeping X-Auth-Token to match your workplace spec!
            'X-Auth-Token': token 
        }
    });
}

// 🚀 NEW: Dedicated Login Handler
export async function loginUser(username, password) {
    const response = await fetch(`${API_URL}/api/auth/login`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ username, password })
    });
    
    // Returns the raw parsed data (success, token, expires, etc.) straight to Login.jsx
    return await response.json();
}

// Verify authorization token
export async function verifyAuth() {
    const token = localStorage.getItem('centreon_auth_token');
    if (!token) return false;
    
    try {
        const response = await authFetch(`${API_URL}/api/auth/verify`);
        const data = await response.json();
        
        if (!data.valid) {
            localStorage.removeItem('centreon_auth_token');
            localStorage.removeItem('centreon_user');
            localStorage.removeItem('centreon_expires');
            return false;
        }
        return true;
    } catch (error) {
        console.error('Auth verification failed:', error);
        return false;
    }
}

// Fetch lists of active pollers
export async function getPollersList() {
    try {
        const response = await authFetch(`${API_URL}/api/centreon/pollers/list`); // Updated to match your app.js layout!
        const data = await response.json();
        return data.pollers || [];
    } catch (error) {
        console.error('Error loading pollers:', error);
        return [];
    }
}

// Check acknowledgement status for a service
export async function checkAckStatus(serviceKey) {
    try {
        const response = await authFetch(`${API_URL}/api/centreon/acknowledgement_status?service_key=${encodeURIComponent(serviceKey)}`);
        return await response.json();
    } catch (e) {
        console.error('Error checking ack status:', e);
        return { acknowledged: false };
    }
}

// Submit a service acknowledgement
export async function acknowledgeService(serviceKey, host, service, status) {
    try {
        const response = await authFetch(`${API_URL}/api/centreon/acknowledge`, {
            method: 'POST',
            body: JSON.stringify({ service_key: serviceKey, host, service, status })
        });
        return await response.json();
    } catch (e) {
        console.error('Error acknowledging service:', e);
        return { success: false };
    }
}