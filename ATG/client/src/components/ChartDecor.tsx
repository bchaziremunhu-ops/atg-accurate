/**
 * Decorative candlestick artwork behind the splash and auth screens.
 * A pale watermark fades in from the top; richer gold candles rise from the
 * bottom edge.
 */
export function ChartDecor() {
  return (
    <>
      <img
        src="/decor/chart-top.png"
        alt=""
        aria-hidden="true"
        draggable={false}
        className="pointer-events-none absolute inset-x-0 top-0 select-none"
      />
      <img
        src="/decor/chart-bottom.png"
        alt=""
        aria-hidden="true"
        draggable={false}
        className="pointer-events-none absolute inset-x-0 bottom-0 select-none"
      />
    </>
  );
}
