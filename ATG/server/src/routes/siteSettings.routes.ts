import { Router } from 'express';
import { asyncHandler } from '../lib/http.js';
import { getSiteSettings, saveSiteSettings } from '../lib/siteSettings.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

export const siteSettingsRouter = Router();
siteSettingsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json(await getSiteSettings());
  }),
);

export const adminSiteSettingsRouter = Router();
adminSiteSettingsRouter.use(requireAuth, requireRole('ADMIN'));
adminSiteSettingsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json(await getSiteSettings());
  }),
);
adminSiteSettingsRouter.put(
  '/',
  asyncHandler(async (req, res) => {
    res.json(await saveSiteSettings(req.body, req.user!.id));
  }),
);
