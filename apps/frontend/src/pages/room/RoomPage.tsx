import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { withGatewayMode } from '../../shared/lib';
import { AppShell } from '../../widgets/app-shell';
import { WorkspaceApp } from '../../widgets/workspace';

export function RoomPage() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  if (!roomId) return <Navigate to="/" replace />;

  return (
    <AppShell>
      <WorkspaceApp
        view="chat"
        roomId={roomId}
        navigateToRoom={(id, options) => navigate(withGatewayMode(`/rooms/${encodeURIComponent(id)}`, location.search), options)}
        navigateToPersonas={() => navigate(withGatewayMode(`/personas?room=${encodeURIComponent(roomId)}`, location.search))}
        navigateToPersona={()=>undefined}
      />
    </AppShell>
  );
}
