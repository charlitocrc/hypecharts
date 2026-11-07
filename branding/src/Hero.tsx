import { useState } from 'react';
import './Hero.css';
import { Icon } from './rikyu-icon';

const candles = [
  { x: 62, top: 350, bot: 420, wt: 330, wb: 440, fill: '#bfb48f' },
  { x: 126, top: 290, bot: 400, wt: 262, wb: 430, fill: '#904e55' },
  { x: 190, top: 270, bot: 350, wt: 250, wb: 372, fill: '#bfb48f' },
  { x: 254, top: 220, bot: 330, wt: 195, wb: 360, fill: '#904e55' },
  { x: 318, top: 150, bot: 275, wt: 125, wb: 300, fill: '#bfb48f' },
];

export default function Hero({ onStart }: { onStart: () => void }) {
  const [hot, setHot] = useState<number | null>(null);
  return (
    <section id="top" className="hero">
      <div className="wrap hero-in">
        <div className="hero-copy">
          <h2 className="hero-eyebrow">Open source<br />charting software</h2>
          <h1 className="hero-free">Free</h1>
          <p className="hero-sub">Precise charts for serious traders.</p>
          <div className="hero-btns">
            <button className="btn btn-khaki" onClick={onStart}>Get started</button>
            <a className="btn btn-plum" href="#open-source">
              <Icon src="./assets/icon-code.svg?tone=mono" size={20} />View source
            </a>
          </div>
        </div>
        <div className="hero-art cut-diag" style={{ ['--c' as string]: '40px' }}>
          <svg viewBox="0 0 400 480" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Rising line chart with candlesticks">
            <rect width="400" height="480" fill="#564e58" />
            <polyline points="-20,262 70,178 118,222 215,118 250,152 345,52 420,-24" fill="none" stroke="#f2efe9" strokeWidth="24" strokeLinejoin="miter" strokeMiterlimit="10" />
            {candles.map((c, i) => (
              <g
                key={i}
                className="candle"
                tabIndex={0}
                onMouseEnter={() => setHot(i)}
                onMouseLeave={() => setHot(null)}
                onFocus={() => setHot(i)}
                onBlur={() => setHot(null)}
              >
                <rect x={c.x - 22} y={c.wt - 10} width={44} height={c.wb - c.wt + 20} fill="transparent" />
                <rect x={c.x - 2} y={c.wt} width={4} height={c.wb - c.wt} fill={hot === i ? '#f2efe9' : c.fill} />
                <rect x={c.x - 12} y={c.top} width={24} height={c.bot - c.top} fill={hot === i ? '#f2efe9' : c.fill} />
              </g>
            ))}
          </svg>
        </div>
      </div>
    </section>
  );
}
