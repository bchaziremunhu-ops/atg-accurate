import { useEffect, useRef } from 'react';
import { createChart, type IChartApi } from 'lightweight-charts';

export function BalanceSparkline({ className }: { className?: string }) {
  const points = [18, 22, 20, 26, 24, 30, 28, 34, 33, 40, 44, 42, 50, 56, 54, 62];
  const w = 240;
  const h = 64;
  const max = Math.max(...points);
  const min = Math.min(...points);
  const path = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * w;
      const y = h - ((p - min) / (max - min)) * (h - 8) - 4;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const area = `${path} L${w},${h} L0,${h} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={className} preserveAspectRatio="none">
      <defs>
        <linearGradient id="spark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#D4AF37" stopOpacity="0.35" />
          <stop offset="1" stopColor="#D4AF37" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="sparkLine" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#F3D98B" />
          <stop offset="1" stopColor="#A67C00" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#spark)" />
      <path d={path} fill="none" stroke="url(#sparkLine)" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export function CandleChart({ candles, className }: { candles: Candle[]; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = createChart(ref.current, {
      width: ref.current.clientWidth,
      height: ref.current.clientHeight,
      layout: { background: { color: '#FFFFFF' }, textColor: '#78716C', fontFamily: 'Poppins, sans-serif' },
      grid: {
        vertLines: { color: '#F5EEDF' },
        horzLines: { color: '#F5EEDF' },
      },
      rightPriceScale: { borderColor: '#EFE4CB' },
      timeScale: { borderColor: '#EFE4CB', timeVisible: true, secondsVisible: false },
      crosshair: { mode: 1 },
    });
    const series = chart.addCandlestickSeries({
      upColor: '#16A34A',
      downColor: '#DC2626',
      borderUpColor: '#16A34A',
      borderDownColor: '#DC2626',
      wickUpColor: '#16A34A',
      wickDownColor: '#DC2626',
    });
    series.setData(candles as unknown as Parameters<typeof series.setData>[0]);
    chart.timeScale().fitContent();
    chartRef.current = chart;

    const onResize = () => {
      if (ref.current) chart.applyOptions({ width: ref.current.clientWidth, height: ref.current.clientHeight });
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      chart.remove();
      chartRef.current = null;
    };
  }, [candles]);

  return <div ref={ref} className={className} />;
}
