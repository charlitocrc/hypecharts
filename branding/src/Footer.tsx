import './Footer.css';

export default function Footer() {
  return (
    <footer className="ftr">
      <div className="wrap ftr-in">
        <p className="ftr-brand">Hypecharts</p>
        <nav aria-label="Footer">
          <a href="#features">Features</a>
          <a href="#exchanges">Exchanges</a>
          <a href="#open-source">Open source</a>
        </nav>
        <p className="ftr-end">Hypecharts.</p>
      </div>
    </footer>
  );
}
