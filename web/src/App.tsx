import { Routes, Route } from 'react-router-dom';
import Splash from './routes/Splash';
import TechTour from './routes/TechTour';
import BusTour from './routes/BusTour';
import TechCreation from './routes/TechCreation';
import BusCreation from './routes/BusCreation';
import Demo from './routes/Demo';
import Floor from './routes/Floor';
import Console from './routes/Console';
import Concepts from './routes/Concepts';
import ConceptsSololift from './routes/ConceptsSololift';
import Brain from './routes/Brain';
import GoodeStream from './routes/GoodeStream';
import GoodeStreamHrAssist from './routes/GoodeStreamHrAssist';
import GoodeStreamDocumentInsight from './routes/GoodeStreamDocumentInsight';
import GoodeStreamTam from './routes/GoodeStreamTam';
import GoodeTalentStory from './routes/GoodeTalentStory';
import NotFound from './routes/NotFound';

export default function App() {
  return (
    <Routes>
      {/* Home now lands directly on the business workbench (dual-path door retired). */}
      <Route path="/" element={<BusTour />} />
      <Route path="/door" element={<Splash />} />
      <Route path="/TechTour" element={<TechTour />} />
      <Route path="/TechTour/creations/:slug" element={<TechCreation />} />
      <Route path="/BusTour" element={<BusTour />} />
      <Route path="/BusTour/creations/:slug" element={<BusCreation />} />
      <Route path="/demo/:slug" element={<Demo />} />
      <Route path="/floor" element={<Floor />} />
      <Route path="/console" element={<Console />} />
      <Route path="/concepts" element={<Concepts />} />
      <Route path="/concepts/sololift.ai" element={<ConceptsSololift />} />
      <Route path="/brain" element={<Brain />} />
      <Route path="/goodestream/story" element={<GoodeTalentStory />} />
      <Route path="/goodestream" element={<GoodeStream />} />
      <Route path="/goodestream/hr-assist" element={<GoodeStreamHrAssist />} />
      <Route path="/goodestream/document-insight" element={<GoodeStreamDocumentInsight />} />
      <Route path="/goodestream/tam" element={<GoodeStreamTam />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
