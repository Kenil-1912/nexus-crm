import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { session } from './api.js';
import Enquiry from './pages/Enquiry.jsx';
import Signup from './pages/Signup.jsx';
import Login from './pages/Login.jsx';
import Portal from './pages/Portal.jsx';
import StaffDashboard from './pages/StaffDashboard.jsx';
import ProspectDetail from './pages/ProspectDetail.jsx';
import EmailLog from './pages/EmailLog.jsx';
import './styles.css';

// Client-side guard for convenience only: the API checks every request itself.
const Guard = ({ kind, to, children }) => (session.get(kind) ? children : <Navigate to={to} replace />);
const staff = (page) => <Guard kind="staff" to="/staff/login">{page}</Guard>;

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Enquiry />} />
        <Route path="/signup/:token" element={<Signup />} />
        <Route path="/login" element={<Login kind="student" />} />
        <Route path="/portal" element={<Guard kind="student" to="/login"><Portal /></Guard>} />
        <Route path="/staff/login" element={<Login kind="staff" />} />
        <Route path="/staff" element={staff(<StaffDashboard />)} />
        <Route path="/staff/prospects/:id" element={staff(<ProspectDetail />)} />
        <Route path="/staff/emails" element={staff(<EmailLog />)} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
