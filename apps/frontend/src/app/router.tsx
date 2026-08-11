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
import {roomsApi} from '../entities/room';
import {defaultAppPath} from './defaultAppPath';

const RootRedirect=()=>{
  const location=useLocation(),[destination,setDestination]=useState<string>();
  useEffect(()=>{
    const controller=new AbortController();
    const loadDestination=async()=>{
      try{
        const setup=await apiRequest<SetupState>('/api/v1/setup',{signal:controller.signal});
        const rooms=setup.completed?await roomsApi.list(controller.signal):[];
        if(!controller.signal.aborted)setDestination(defaultAppPath(setup,rooms));
      }catch(issue){
        if(!controller.signal.aborted)console.error('Failed to resolve the default room',issue);
      }
    };
    void loadDestination();
    return()=>controller.abort();
  },[]);
  if(!destination)return null;
  return <Navigate to={withGatewayMode(destination,location.search)} replace/>;
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
