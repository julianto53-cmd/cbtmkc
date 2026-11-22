import { motion } from 'motion/react';

export function MkcLogoMark({ size = 36, light = false }: { size?: number; light?: boolean }) {
  const petalFill = light ? '#ECFDF5' : '#0F5132';
  const accentFill = light ? '#FCD34D' : '#B45309';
  const coreStroke = light ? '#34D399' : '#059669';

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Logo MKC CBT"
      className="shrink-0"
    >
      {/* 8-petal geometric rosette motif */}
      {[0, 45, 90, 135, 180, 225, 270, 315].map((angle, i) => (
        <path
          key={angle}
          d="M32 6C36.5 13 38.5 20.5 32 27C25.5 20.5 27.5 13 32 6Z"
          fill={i % 2 === 0 ? petalFill : coreStroke}
          fillOpacity={i % 2 === 0 ? 0.92 : 0.72}
          transform={`rotate(${angle} 32 32)`}
        />
      ))}
      <circle cx="32" cy="32" r="10.5" fill={light ? '#064E3B' : '#FFFFFF'} stroke={accentFill} strokeWidth="2" />
      <path
        d="M27.2 35.5V28.5L32 33.2L36.8 28.5V35.5"
        stroke={accentFill}
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function AnimatedPetalMotif() {
  const petals = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden select-none" aria-hidden="true">
      {/* Large rotating primary petal mandala derived from MKC crest */}
      <motion.div
        className="absolute -right-24 -top-24 w-[440px] h-[440px] opacity-25"
        animate={{ rotate: 360 }}
        transition={{ duration: 70, repeat: Infinity, ease: 'linear' }}
      >
        <svg viewBox="0 0 200 200" fill="none" className="w-full h-full">
          {petals.map((deg, idx) => (
            <path
              key={deg}
              d="M100 12C116 38 122 68 100 94C78 68 84 38 100 12Z"
              stroke={idx % 2 === 0 ? '#A7F3D0' : '#FDE68A'}
              strokeWidth="1.1"
              fill={idx % 2 === 0 ? '#10B981' : '#F59E0B'}
              fillOpacity={0.08}
              transform={`rotate(${deg} 100 100)`}
            />
          ))}
          <circle cx="100" cy="100" r="24" stroke="#FDE68A" strokeWidth="1" strokeDasharray="3 4" />
        </svg>
      </motion.div>

      {/* Secondary gentle breathing petal cluster bottom-left */}
      <motion.div
        className="absolute -left-16 bottom-12 w-[280px] h-[280px] opacity-20"
        animate={{ scale: [1, 1.07, 1], rotate: [-12, 8, -12] }}
        transition={{ duration: 16, repeat: Infinity, ease: 'easeInOut' }}
      >
        <svg viewBox="0 0 200 200" fill="none" className="w-full h-full">
          {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
            <path
              key={deg}
              d="M100 18C118 48 120 75 100 98C80 75 82 48 100 18Z"
              stroke="#ECFDF5"
              strokeWidth="1"
              fill="#34D399"
              fillOpacity={0.12}
              transform={`rotate(${deg} 100 100)`}
            />
          ))}
        </svg>
      </motion.div>
    </div>
  );
}
