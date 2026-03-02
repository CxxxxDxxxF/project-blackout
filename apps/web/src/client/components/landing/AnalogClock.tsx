import { useEffect, useMemo, useState } from 'react';

function getClockParts(now: Date): {
  hourDeg: number;
  minuteDeg: number;
  secondDeg: number;
  label: string;
} {
  const hours = now.getHours() % 12;
  const minutes = now.getMinutes();
  const seconds = now.getSeconds();
  const hourDeg = hours * 30 + minutes * 0.5;
  const minuteDeg = minutes * 6 + seconds * 0.1;
  const secondDeg = seconds * 6;
  const label = `Local time ${now.toLocaleTimeString()}`;
  return { hourDeg, minuteDeg, secondDeg, label };
}

interface AnalogClockProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

const sizeClassByVariant: Record<NonNullable<AnalogClockProps['size']>, string> = {
  sm: 'h-28 w-28',
  md: 'h-32 w-32',
  lg: 'h-44 w-44',
};

export function AnalogClock({ className = '', size = 'md' }: AnalogClockProps) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(new Date());
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, []);

  const { hourDeg, minuteDeg, secondDeg, label } = useMemo(() => getClockParts(now), [now]);
  const ticks = useMemo(() => Array.from({ length: 60 }, (_, idx) => idx), []);

  return (
    <div
      role="img"
      aria-label={label}
      data-testid="home-analog-clock"
      className={`relative ${sizeClassByVariant[size]} rounded-full border border-border/70 bg-background/60 shadow-sm backdrop-blur-sm ${className}`}
    >
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full">
        <circle cx="50" cy="50" r="48" className="fill-[hsl(var(--background)/0.72)]" />
        <circle cx="50" cy="50" r="44" className="fill-none stroke-[hsl(var(--border)/0.45)]" />
        <circle cx="50" cy="50" r="38" className="fill-none stroke-[hsl(var(--border)/0.2)]" />
        {ticks.map((tick) => {
          const isMajor = tick % 5 === 0;
          const angle = (tick * Math.PI) / 30;
          const inner = isMajor ? 34 : 36;
          const outer = 40;
          const x1 = 50 + inner * Math.sin(angle);
          const y1 = 50 - inner * Math.cos(angle);
          const x2 = 50 + outer * Math.sin(angle);
          const y2 = 50 - outer * Math.cos(angle);

          return (
            <line
              key={`tick-${tick}`}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={isMajor ? 'hsl(var(--foreground) / 0.72)' : 'hsl(var(--muted-foreground) / 0.4)'}
              strokeWidth={isMajor ? 1.3 : 0.75}
              strokeLinecap="round"
            />
          );
        })}
      </svg>

      <div
        data-testid="home-clock-hour-hand"
        className="absolute left-1/2 top-1/2 h-[28%] w-[4px] -translate-x-1/2 -translate-y-[92%] rounded-full bg-foreground origin-bottom shadow-sm"
        style={{ transform: `translate(-50%, -92%) rotate(${hourDeg}deg)`, transformOrigin: '50% 92%' }}
      />
      <div
        data-testid="home-clock-minute-hand"
        className="absolute left-1/2 top-1/2 h-[35%] w-[2px] -translate-x-1/2 -translate-y-[94%] rounded-full bg-muted-foreground origin-bottom shadow-sm"
        style={{ transform: `translate(-50%, -94%) rotate(${minuteDeg}deg)`, transformOrigin: '50% 94%' }}
      />
      <div
        data-testid="home-clock-second-hand"
        className="absolute left-1/2 top-1/2 h-[37%] w-px -translate-x-1/2 -translate-y-[95%] rounded-full bg-primary origin-bottom"
        style={{ transform: `translate(-50%, -95%) rotate(${secondDeg}deg)`, transformOrigin: '50% 95%' }}
      />
      <div className="absolute left-1/2 top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary border border-background/70 shadow-[0_0_0_2px_hsl(var(--background)/0.8)]" />
      <div className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground/80" />
    </div>
  );
}
