import './Stats.css';

export default function Stats() {
  return (
    <section id="features" className="stats">
      <div className="wrap stats-in">
        <article className="stat stat-plum cut-diag">
          <p className="stat-num">200</p>
          <h3 className="stat-label">Indicators</h3>
        </article>
        <article id="exchanges" className="stat stat-brick cut-diag">
          <p className="stat-num">10</p>
          <h3 className="stat-label">Exchanges</h3>
        </article>
      </div>
    </section>
  );
}
