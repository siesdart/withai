import './style.css';
import { createRoot } from 'react-dom/client';

const App = () => (
  <h1 className="text-3xl font-bold underline">Hello world!</h1>
);

createRoot(document.getElementById('app')!).render(<App />);
