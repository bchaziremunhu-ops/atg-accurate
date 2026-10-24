import { z } from 'zod';
import { prisma } from './prisma.js';

const SETTINGS_KEY = 'siteContent';

const httpUrl = z.string().trim().max(2048).transform((value) => {
  if (!value || value.startsWith('//') || /^[a-z][a-z\d+.-]*:/i.test(value)) return value;
  return `https://${value}`;
}).refine((value) => {
  if (!value) return true;
  try {
    const parsed = new URL(value);
    return /^https?:\/\//i.test(value) && Boolean(parsed.hostname) && ['https:', 'http:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}, 'Enter a valid HTTP or HTTPS link.');

const supportPhone = z.string().trim().transform((value) => value.replace(/[\s()+.-]/g, '')).refine(
  (value) => !value || /^[1-9]\d{7,14}$/.test(value),
  'Enter a WhatsApp number with country code, using digits only.',
);

const dashboardPostSchema = z.object({
  id: z.string().trim().min(1).max(100),
  enabled: z.boolean(),
  title: z.string().trim().max(120),
  body: z.string().trim().max(3000),
  linkLabel: z.string().trim().max(60),
  linkUrl: httpUrl,
}).strict().superRefine((post, context) => {
  if (post.enabled && (!post.title || !post.body)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['title'],
      message: 'An enabled dashboard post needs a title and message.',
    });
  }
  if (Boolean(post.linkLabel) !== Boolean(post.linkUrl)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['linkUrl'],
      message: 'Provide both a link label and link URL, or leave both empty.',
    });
  }
});

const currentSiteSettingsSchema = z.object({
  dashboardPosts: z.array(dashboardPostSchema),
  support: z.object({
    email: z.string().trim().max(254).refine((value) => !value || z.string().email().safeParse(value).success, 'Enter a valid support email address.'),
    whatsappPhone: supportPhone,
  }).strict(),
}).strict();

const legacySiteSettingsSchema = z.object({
  dashboardPost: z.object({
    enabled: z.boolean(),
    title: z.string().trim().max(120),
    body: z.string().trim().max(3000),
    linkLabel: z.string().trim().max(60),
    linkUrl: httpUrl,
  }).strict(),
  support: z.object({
    email: z.string().trim().max(254).refine((value) => !value || z.string().email().safeParse(value).success, 'Enter a valid support email address.'),
    whatsappPhone: supportPhone,
  }).strict(),
}).strict();

export const siteSettingsSchema = z.preprocess((input) => {
  if (
    input !== null &&
    typeof input === 'object' &&
    'dashboardPost' in input &&
    !('dashboardPosts' in input)
  ) {
    const legacy = legacySiteSettingsSchema.parse(input);
    return {
      dashboardPosts: legacy.dashboardPost.title || legacy.dashboardPost.body
        ? [{ id: 'legacy-dashboard-post', ...legacy.dashboardPost }]
        : [],
      support: legacy.support,
    };
  }
  return input;
}, currentSiteSettingsSchema);

export type SiteSettings = z.infer<typeof siteSettingsSchema>;

export const DEFAULT_SITE_SETTINGS: SiteSettings = {
  dashboardPosts: [],
  support: {
    email: '',
    whatsappPhone: '263774144795',
  },
};

export async function getSiteSettings(): Promise<SiteSettings> {
  const row = await prisma.setting.findUnique({ where: { key: SETTINGS_KEY } });
  return row ? siteSettingsSchema.parse(JSON.parse(row.value)) : DEFAULT_SITE_SETTINGS;
}

export async function saveSiteSettings(input: unknown, actorId: string): Promise<SiteSettings> {
  const settings = siteSettingsSchema.parse(input);
  await prisma.setting.upsert({
    where: { key: SETTINGS_KEY },
    create: { key: SETTINGS_KEY, value: JSON.stringify(settings), updatedById: actorId },
    update: { value: JSON.stringify(settings), updatedById: actorId },
  });
  return settings;
}
