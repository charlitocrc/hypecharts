import { useEffect, useState } from 'react';
import './App.css';
import Header from './Header';
import Hero from './Hero';
import Stats from './Stats';
import Strip from './Strip';
import OpenSource from './OpenSource';
import Cta from './Cta';
import Footer from './Footer';
import Modal from './Modal';

export default function App() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const start = () => setOpen(true);
  return (
    <div className="app">
      <Header onStart={start} />
      <main>
        <Hero onStart={start} />
        <Stats />
        <Strip />
        <OpenSource />
        <Cta onStart={start} />
      </main>
      <Footer />
      {open && <Modal onClose={() => setOpen(false)} />}
    </div>
  );
}
