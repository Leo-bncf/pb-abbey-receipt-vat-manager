import Upload from './pages/Upload';
import Dashboard from './pages/Dashboard';
import Admin from './pages/Admin';
import Reports from './pages/Reports';


export const PAGES = {
    "Upload": Upload,
    "Dashboard": Dashboard,
    "Admin": Admin,
    "Reports": Reports,
}

export const pagesConfig = {
    mainPage: "Upload",
    Pages: PAGES,
};