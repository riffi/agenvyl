import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { withGatewayMode } from '../../shared/lib';
import { AppShell } from '../../widgets/app-shell';
import { WorkspaceApp } from '../../widgets/workspace';

export function PersonasPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const {personaId}=useParams();
  const roomId = searchParams.get('room') ?? 'demo-room';
  const personaPath=(id?:string)=>withGatewayMode(`${id?`/personas/${encodeURIComponent(id)}`:'/personas'}?room=${encodeURIComponent(roomId)}`,location.search);

  return (
    <AppShell>
      <WorkspaceApp
        view="personas"
        roomId={roomId}
        navigateToRoom={(id, options) => navigate(withGatewayMode(`/rooms/${encodeURIComponent(id)}`, location.search), options)}
        navigateToPersonas={() => navigate(personaPath())}
        selectedPersonaId={personaId}
        navigateToPersona={(id,options)=>navigate(personaPath(id),options)}
      />
    </AppShell>
  );
}
