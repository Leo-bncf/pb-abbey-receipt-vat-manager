import Upload from './pages/Upload';
import Dashboard from './pages/Dashboard';
import Reports from './pages/Reports';
import VATReturn from './pages/VATReturn';
import Review from './pages/Review';
import __Layout from './Layout.jsx';


export const PAGES = {
    "Upload": Upload,
    "Dashboard": Dashboard,
    "Reports": Reports,
    "VATReturn": VATReturn,
    "Review": Review,
}

export const pagesConfig = {
    mainPage: "Upload",
    Pages: PAGES,
    Layout: __Layout,
};