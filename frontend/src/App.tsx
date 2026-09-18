import { BrowserRouter, Routes, Route } from 'react-router-dom';
import ErrorBoundary from './components/error/ErrorBoundary';
// Login and Signup pages removed in public deployment
import Dashboard from './pages/Dashboard';
import Profile from './pages/Profile';
import Simulations from './pages/Simulations';
import Landing from './pages/Landing';

function PrivateRoute({ children }: { children: React.ReactNode }) {
  // Auth removed: allow access to all routes
  return (
    <ErrorBoundary label="Page" fullHeight onReset={() => window.location.reload()}>
      {children}
    </ErrorBoundary>
  );
}

function RootRoute() {
  // Always show Landing as default public entrypoint
  return <Landing />;
}

// Always shows Landing regardless of auth state — used by logo click
function LandingRoute() {
  return <Landing />;
}

export default function App() {
  return (
    <BrowserRouter>
        <Routes>
          {/* Login/Signup removed - app is public */}
          <Route
            path="/dashboard"
            element={
              <PrivateRoute>
                <Dashboard />
              </PrivateRoute>
            }
          />
          <Route
            path="/profile"
            element={
              <PrivateRoute>
                <Profile />
              </PrivateRoute>
            }
          />
          <Route
            path="/simulations"
            element={
              <PrivateRoute>
                <Simulations />
              </PrivateRoute>
            }
          />
          <Route path="/" element={<RootRoute />} />
          <Route path="/landing" element={<LandingRoute />} />
        </Routes>
    </BrowserRouter>
  );
}
