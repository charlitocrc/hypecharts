import './Strip.css';

export default function Strip() {
  return (
    <section className="strip-sec" aria-label="Free and open source">
      <div className="wrap">
        <div className="strip cut-diag">
          <p className="strip-a">Free</p>
          <svg className="strip-zig" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <polyline points="72,-2 28,50 52,102" fill="none" stroke="#252627" strokeWidth="12" vectorEffect="non-scaling-stroke" strokeLinejoin="miter" />
          </svg>
          <p className="strip-b">Open source</p>
        </div>
      </div>
    </section>
  );
}
