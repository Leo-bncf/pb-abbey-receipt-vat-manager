import Upload from './pages/Upload';
import Dashboard from './pages/Dashboard';
import Admin from './pages/Admin';
import Reports from './pages/Reports';
import __Layout from './Layout.jsx';


export const PAGES = {
    "Upload": Upload,
    "Dashboard": Dashboard,
    "Admin": Admin,
    "Reports": Reports,
}

export const pagesConfig = {
    mainPage: "Upload",
    Pages: PAGES,
    Layout: __Layout,
};