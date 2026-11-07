import { useState } from 'react';
import './Header.css';
import { Icon } from './rikyu-icon';

const links = [
  { label: 'Features', href: '#features' },
  { label: 'Exchanges', href: '#exchanges' },
  { label: 'Open source', href: '#open-source' },
];

export default function Header({ onStart }: { onStart: () => void }) {
  const [menu, setMenu] = useState(false);
  return (
    <header className="hdr">
      <div className="wrap hdr-in">
        <a href="#top" className="logo" role="img" aria-label="Hypecharts" />
        <nav className="hdr-nav" aria-label="Primary">
          {links.map((l) => (
            <a key={l.label} href={l.href}>{l.label}</a>
          ))}
        </nav>
        <button className="btn btn-khaki hdr-cta" onClick={onStart}>Get started</button>
        <button
          className="hdr-burger"
          aria-label={menu ? 'Close menu' : 'Open menu'}
          aria-expanded={menu}
          onClick={() => setMenu(!menu)}
        >
          {menu ? <Icon src="./assets/icon-close.svg?tone=mono" size={26} /> : <Icon src="./assets/icon-menu.svg?tone=mono" size={26} />}
        </button>
      </div>
      {menu && (
        <div className="hdr-panel">
          {links.map((l) => (
            <a key={l.label} href={l.href} onClick={() => setMenu(false)}>{l.label}</a>
          ))}
          <button className="btn btn-khaki" onClick={() => { setMenu(false); onStart(); }}>Get started</button>
        </div>
      )}
    </header>
  );
}
