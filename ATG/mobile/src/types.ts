export interface User {
  id: string;
  name: string;
  email: string;
  role: 'USER' | 'ADMIN';
  isVip: boolean;
  membership?: string;
  avatarUrl?: string | null;
  vipExpiresAt?: string | null;
  phone?: string | null;
  country?: string | null;
  bio?: string | null;
  stats?: { courses: number; signals: number; certificates: number };
}

export interface SiteSettings {
  dashboardPosts: {
    id: string;
    enabled: boolean;
    title: string;
    body: string;
    linkLabel: string;
    linkUrl: string;
  }[];
  support: {
    email: string;
    whatsappPhone: string;
  };
}

export interface RegisterInput {
  name: string;
  phone: string;
  country: string;
  nationality: string;
  dateOfBirth: string;
  address?: string;
  securityQuestion: string;
  securityAnswer: string;
  password: string;
  confirmPassword: string;
  acceptTerms: boolean;
  acceptPrivacy: boolean;
}

export interface Signal {
  id: string;
  pair: string;
  market: string;
  direction: 'BUY' | 'SELL';
  entry: number | null;
  takeProfit: number | null;
  stopLoss: number | null;
  timeframe: string;
  tier: 'FREE' | 'VIP';
  audience: string;
  status: 'OPEN' | 'HIT_TP' | 'HIT_SL' | 'CANCELLED';
  publishedAt: string;
  locked?: boolean;
  analysis?: string | null;
  author?: { id: string; name: string; avatarUrl?: string | null; role?: string };
}

export interface Lesson {
  id: string;
  title: string;
  description?: string | null;
  videoUrl?: string | null;
  durationMin: number;
  order: number;
  locked?: boolean;
  completed?: boolean;
}

export interface Course {
  id: string;
  slug: string;
  title: string;
  description?: string | null;
  level: string;
  price: number;
  currency?: string;
  isFree?: boolean;
  entitled?: boolean;
  isVip: boolean;
  lessonCount: number;
  durationMin: number;
  lessons: Lesson[];
  progress: number;
}
