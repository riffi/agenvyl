import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { NotFoundPage } from '../pages/not-found';
import { PersonasPage } from '../pages/personas';
import { RoomPage } from '../pages/room';
import { withGatewayMode } from '../shared/lib';

function RootRedirect() {
  const location = useLocation();
  return <Navigate to={withGatewayMode('/rooms/demo-room', location.search)} replace />;
}

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<RootRedirect />} />
        <Route path="/rooms/:roomId" element={<RoomPage />} />
        <Route path="/personas" element={<PersonasPage />} />
        <Route path="/personas/:personaId" element={<PersonasPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  );
}
