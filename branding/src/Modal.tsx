import './Modal.css';

export default function Modal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal cut" role="dialog" aria-modal="true" aria-labelledby="m-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="m-title">Get started</h2>
        <p>Free charting software. Open source.</p>
        <ul>
          <li><span>200</span> Indicators</li>
          <li><span>10</span> Exchanges</li>
        </ul>
        <div className="modal-btns">
          <button className="btn btn-dark" onClick={onClose}>Open charts</button>
          <button className="btn btn-plum" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
