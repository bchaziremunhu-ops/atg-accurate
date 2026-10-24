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
