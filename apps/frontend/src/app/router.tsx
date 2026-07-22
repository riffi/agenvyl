import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import {useEffect,useState} from 'react';
import type {SetupState} from '@agenvyl/contracts';
import { NotFoundPage } from '../pages/not-found';
import { PersonasPage } from '../pages/personas';
import { RoomPage } from '../pages/room';
import { withGatewayMode } from '../shared/lib';
import {SetupPage} from '../pages/setup';
import {HarnessSettingsPage} from '../pages/harness-settings';
import {apiRequest} from '../shared/api';
import {AppShell} from '../widgets/app-shell';

function RootRedirect() {
  const location = useLocation();
  const [setup,setSetup]=useState<SetupState>();
  useEffect(()=>{void apiRequest<SetupState>('/api/v1/setup').then(setSetup);},[]);
  if(!setup)return null;
  return <Navigate to={setup.completed&&setup.firstRoomId?withGatewayMode(`/rooms/${setup.firstRoomId}`,location.search):'/setup'} replace />;
}

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<RootRedirect />} />
        <Route path="/setup" element={<SetupPage />} />
        <Route path="/rooms/:roomId" element={<RoomPage />} />
        <Route path="/personas" element={<PersonasPage />} />
        <Route path="/personas/:personaId" element={<PersonasPage />} />
        <Route path="/settings/harnesses" element={<AppShell><HarnessSettingsPage /></AppShell>} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  );
}
