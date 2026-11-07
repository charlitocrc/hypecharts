import './OpenSource.css';
import { Icon } from './rikyu-icon';

export default function OpenSource() {
  return (
    <section id="open-source" className="os">
      <div className="wrap os-in">
        <div className="os-copy">
          <h2>Open source<br />charting software</h2>
          <p>Free to use. Open to inspect.</p>
          <a className="btn btn-khaki" href="#open-source">
            <Icon src="./assets/icon-code.svg?tone=mono" size={20} />View source
          </a>
        </div>
        <div className="os-art cut-diag" style={{ ['--c' as string]: '36px' }}>
          <svg viewBox="0 0 300 300" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Rising zigzag line">
            <rect width="300" height="300" fill="#bfb48f" />
            <polyline points="-20,260 60,180 100,225 190,130 225,165 330,40" fill="none" stroke="#252627" strokeWidth="26" strokeLinejoin="miter" strokeMiterlimit="10" />
          </svg>
        </div>
      </div>
    </section>
  );
}
