import './Cta.css';

export default function Cta({ onStart }: { onStart: () => void }) {
  return (
    <section className="cta-sec">
      <div className="wrap">
        <div className="cta cut">
          <h2>Free charting software</h2>
          <button className="btn btn-dark" onClick={onStart}>Get started</button>
        </div>
      </div>
    </section>
  );
}
