import { createRoot } from 'react-dom/client';
import App from './App';
import 'react-image-crop/dist/ReactCrop.css';
import './styles.css';

createRoot(document.getElementById('root')!).render(<App />);
