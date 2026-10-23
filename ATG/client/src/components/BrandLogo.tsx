export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 104 60" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="atgGold" x1="0" y1="0" x2="104" y2="60" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#F3D98B" />
          <stop offset="0.45" stopColor="#D4AF37" />
          <stop offset="1" stopColor="#A67C00" />
        </linearGradient>
      </defs>
      <text
        x="4"
        y="40"
        fontFamily="Poppins, sans-serif"
        fontWeight="800"
        fontSize="44"
        fill="url(#atgGold)"
        letterSpacing="1"
      >
        ATG
      </text>
    </svg>
  );
}

export function BrandLogo({ subtitle = true, size = 'md' }: { subtitle?: boolean; size?: 'sm' | 'md' | 'lg' }) {
  const map = { sm: 'text-xs', md: 'text-base', lg: 'text-xl' };
  return (
    <div className="flex flex-col items-center text-center">
      <p className={`${map[size]} font-extrabold tracking-[0.1em] gold-text`}>Accurate Trading Group</p>
      {subtitle && (
        <p className="mt-1 text-[9px] font-medium tracking-[0.3em] text-gold-600">BEST TRADING EXPERIENCE</p>
      )}
    </div>
  );
}
