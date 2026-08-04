import {Navigate,RouterProvider,createBrowserRouter,useLocation} from 'react-router-dom';
import {useEffect,useState} from 'react';
import type {SetupState} from '@agenvyl/contracts';
import {NotFoundPage} from '../pages/not-found';
import {PersonasPage} from '../pages/personas';
import {RoomPage} from '../pages/room';
import {withGatewayMode} from '../shared/lib';
import {SetupPage} from '../pages/setup';
import {HarnessSettingsPage} from '../pages/harness-settings';
import {ProjectsPage} from '../pages/projects';
import {apiRequest} from '../shared/api';
import {AppShell} from '../widgets/app-shell';

const RootRedirect=()=>{
  const location=useLocation(),[setup,setSetup]=useState<SetupState>();
  useEffect(()=>{void apiRequest<SetupState>('/api/v1/setup').then(setSetup);},[]);
  if(!setup)return null;
  return <Navigate to={setup.completed&&setup.firstRoomId?withGatewayMode(`/rooms/${setup.firstRoomId}`,location.search):'/setup'} replace/>;
};

const harnessSettings=<AppShell><HarnessSettingsPage/></AppShell>;
const router=createBrowserRouter([
  {path:'/',element:<RootRedirect/>},
  {path:'/setup',element:<SetupPage/>},
  {path:'/rooms/:roomId',element:<RoomPage/>},
  {path:'/personas',element:<PersonasPage/>},
  {path:'/personas/:personaId',element:<PersonasPage/>},
  {path:'/settings/harnesses',element:harnessSettings},
  {path:'/settings/harnesses/:instanceId',element:harnessSettings},
  {path:'/projects',element:<AppShell><ProjectsPage/></AppShell>},
  {path:'*',element:<NotFoundPage/>},
]);

export const AppRouter=()=> <RouterProvider router={router}/>;
