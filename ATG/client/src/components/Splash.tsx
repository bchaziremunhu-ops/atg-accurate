import { BrandLogo } from './BrandLogo';
import { ChartDecor } from './ChartDecor';

/**
 * Branded splash screen shown for ~3 seconds on first load (see App.tsx).
 */
export function Splash() {
  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center overflow-hidden bg-cream-50 pb-44">
      <ChartDecor />
      <div className="relative z-10 flex flex-col items-center">
        <div className="animate-splash-pop flex flex-col items-center">
          <div className="grid h-24 w-24 place-items-center rounded-3xl bg-gold-gradient shadow-gold">
            <span className="text-3xl font-black tracking-tight text-white">ATG</span>
          </div>
        </div>
        <div className="mt-6">
          <BrandLogo size="md" />
        </div>
        <div className="mt-8 h-1.5 w-40 overflow-hidden rounded-full bg-cream-200">
          <div className="animate-splash-bar h-full w-1/3 rounded-full bg-gold-gradient" />
        </div>
        <p className="mt-4 text-[10px] font-medium tracking-[0.3em] text-ink-faint">LOADING…</p>
      </div>
    </div>
  );
}
