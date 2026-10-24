import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { AdminRoute, ProtectedRoute } from './components/guards';
import { Splash } from './components/Splash';

const Login = lazy(() => import('./pages/Login'));
const Register = lazy(() => import('./pages/Register'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'));
const Legal = lazy(() => import('./pages/Legal'));
const Home = lazy(() => import('./pages/Home'));
const Education = lazy(() => import('./pages/Education'));
const CourseDetail = lazy(() => import('./pages/CourseDetail'));
const Signals = lazy(() => import('./pages/Signals'));
const SignalDetail = lazy(() => import('./pages/SignalDetail'));
const Community = lazy(() => import('./pages/Community'));
const GroupChat = lazy(() => import('./pages/GroupChat'));
const Wallet = lazy(() => import('./pages/Wallet'));
const BrokerFunds = lazy(() => import('./pages/BrokerFunds'));
const Profile = lazy(() => import('./pages/Profile'));
const SettingsPage = lazy(() => import('./pages/Settings'));
const Purchases = lazy(() => import('./pages/Purchases'));
const Receipt = lazy(() => import('./pages/Receipt'));
const Subscription = lazy(() => import('./pages/Subscription'));
const Notifications = lazy(() => import('./pages/Notifications'));
const Support = lazy(() => import('./pages/Support'));
const Saved = lazy(() => import('./pages/Saved'));
const Certificates = lazy(() => import('./pages/Certificates'));
const CertificateView = lazy(() => import('./pages/CertificateView'));
const Admin = lazy(() => import('./pages/Admin'));

function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-2 px-6 text-center">
      <p className="text-3xl font-extrabold gold-text">404</p>
      <p className="text-sm text-ink-muted">This page doesn&apos;t exist.</p>
      <a href="/home" className="btn-gold px-5 py-2.5 text-sm">
        Back home
      </a>
    </div>
  );
}

export default function App() {
  return (
    <Suspense fallback={<Splash />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/legal" element={<Legal />} />
        <Route
          element={
            <ProtectedRoute>
              <AppShell />
            </ProtectedRoute>
          }
        >
          <Route path="/" element={<Navigate to="/home" replace />} />
          <Route path="/home" element={<Home />} />
          <Route path="/education" element={<Education />} />
          <Route path="/education/:slug" element={<CourseDetail />} />
          <Route path="/signals" element={<Signals />} />
          <Route path="/signals/:id" element={<SignalDetail />} />
          <Route path="/community" element={<Community />} />
          <Route path="/community/:id" element={<GroupChat />} />
          <Route path="/wallet" element={<Wallet />} />
          <Route path="/broker-funds" element={<BrokerFunds />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/profile/settings" element={<SettingsPage />} />
          <Route path="/profile/purchases" element={<Purchases />} />
          <Route path="/receipts/:id" element={<Receipt />} />
          <Route path="/profile/subscription" element={<Subscription />} />
          <Route path="/profile/saved" element={<Saved />} />
          <Route path="/profile/certificates" element={<Certificates />} />
          <Route path="/profile/certificates/:id" element={<CertificateView />} />
          <Route path="/notifications" element={<Notifications />} />
          <Route path="/support" element={<Support />} />
          <Route
            path="/admin"
            element={
              <AdminRoute>
                <Admin />
              </AdminRoute>
            }
          />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
