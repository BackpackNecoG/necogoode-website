import { Routes, Route } from 'react-router-dom';
import Splash from './routes/Splash';
import TechTour from './routes/TechTour';
import BusTour from './routes/BusTour';
import TechCreation from './routes/TechCreation';
import BusCreation from './routes/BusCreation';
import Demo from './routes/Demo';
import Floor from './routes/Floor';
import NotFound from './routes/NotFound';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Splash />} />
      <Route path="/TechTour" element={<TechTour />} />
      <Route path="/TechTour/creations/:slug" element={<TechCreation />} />
      <Route path="/BusTour" element={<BusTour />} />
      <Route path="/BusTour/creations/:slug" element={<BusCreation />} />
      <Route path="/demo/:slug" element={<Demo />} />
      <Route path="/floor" element={<Floor />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
