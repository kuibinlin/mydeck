import { BrowserRouter, Routes, Route, Navigate } from "react-router";
import { AuthProvider } from "@/context/AuthContext";
import { ThemeProvider } from "@/context/ThemeContext";
import PublicLayout from "@/components/layout/PublicLayout";
import ProtectedRoute from "@/components/layout/ProtectedRoute";

// Public
import LandingPage from "@/features/landing/LandingPage";
import AuthPage from "@/features/auth/AuthPage";
import PrivacyPolicy from "@/features/legal/PrivacyPolicy";
import TermsOfService from "@/features/legal/TermsOfService";

// Dashboard
import Dashboard from "@/features/dashboard/Dashboard";

// Flashcards
import FlashcardList from "@/features/flashcards/FlashcardList";
import FlashcardStudy from "@/features/flashcards/FlashcardStudy";
import FlashcardEdit from "@/features/flashcards/FlashcardEdit";

// Challenges
import ChallengeList from "@/features/challenges/ChallengeList";
import ChallengePlay from "@/features/challenges/ChallengePlay";
import ChallengeEdit from "@/features/challenges/ChallengeEdit";

// Leaderboard
import Leaderboard from "@/features/leaderboard/Leaderboard";
import LeaderboardOverview from "@/features/leaderboard/LeaderboardOverview";

// Settings
import SettingsPage from "@/features/settings/SettingsPage";

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <Routes>
            {/* PUBLIC — landing page + auth share PublicLayout (PublicHeader + Footer) */}
            <Route element={<PublicLayout />}>
              <Route path="/" element={<LandingPage />} />
              <Route path="/login" element={<AuthPage />} />
              <Route path="/privacy" element={<PrivacyPolicy />} />
              <Route path="/terms" element={<TermsOfService />} />
            </Route>

            {/* PROTECTED — Header + Footer rendered by ProtectedRoute */}
            <Route element={<ProtectedRoute />}>
              <Route path="/dashboard" element={<Dashboard />} />

              <Route path="/flashcards" element={<FlashcardList />} />
              <Route path="/flashcards/new" element={<FlashcardEdit />} />
              <Route path="/flashcards/:id" element={<FlashcardStudy />} />
              <Route path="/flashcards/:id/edit" element={<FlashcardEdit />} />

              <Route path="/challenges" element={<ChallengeList />} />
              <Route path="/challenges/new" element={<ChallengeEdit />} />
              <Route path="/challenges/:id" element={<ChallengePlay />} />
              <Route path="/challenges/:id/edit" element={<ChallengeEdit />} />

              <Route path="/leaderboard" element={<LeaderboardOverview />} />
              <Route path="/leaderboard/:versionId" element={<Leaderboard />} />

              <Route path="/settings" element={<SettingsPage />} />
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
