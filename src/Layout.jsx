import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  LayoutDashboard, Upload, FileSpreadsheet, Shield,
  Menu, X, LogOut, ChevronRight, Building2, Home
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { base44 } from '@/api/base44Client';
import { createPageUrl } from '@/utils';

const navigation = [
  { name: 'Hub', icon: Home, path: '/' },
  { name: 'Dashboard', icon: LayoutDashboard, page: 'Dashboard' },
  { name: 'Upload', icon: Upload, page: 'Upload' },
  { name: 'Reports', icon: FileSpreadsheet, page: 'Reports' },
  { name: 'Admin', icon: Shield, page: 'Admin', adminOnly: true },
];

export default function Layout({ children, currentPageName }) {
  const [user, setUser] = useState(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  useEffect(() => {
    loadUser();
  }, []);

  const loadUser = async () => {
    try {
      const userData = await base44.auth.me();
      setUser(userData);
    } catch (e) {
      console.error('Error loading user:', e);
    }
  };

  const handleLogout = () => {
    base44.auth.logout();
  };

  const isAdmin = user?.role === 'admin';

  const filteredNav = navigation.filter(item => !item.adminOnly || isAdmin);

  return (
    <div className="min-h-screen bg-background">
      {/* Mobile Header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-lg border-b border-neutral-200">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded bg-gradient-to-br from-neutral-800 to-neutral-900 flex items-center justify-center">
              <Building2 className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="font-display font-semibold text-neutral-900 text-base">PB Abbey</h1>
              <p className="text-xs text-neutral-500">Receipts & VAT</p>
            </div>
          </div>
          <button
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="p-2 hover:bg-neutral-100 rounded-lg"
          >
            {isSidebarOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </div>

      {/* Mobile Sidebar */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div
            initial={{ opacity: 0, x: -300 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -300 }}
            className="lg:hidden fixed inset-0 z-40 bg-white"
          >
            <div className="pt-20 px-4">
              <nav className="space-y-1">
                {filteredNav.map((item) => {
                  const isActive = currentPageName === item.page;
                  return (
                    <Link
                      key={item.name}
                      to={item.path || createPageUrl(item.page)}
                      onClick={() => setIsSidebarOpen(false)}
                      className={`
                        flex items-center gap-3 px-4 py-3 rounded transition-all
                        ${isActive 
                          ? 'bg-neutral-100 text-neutral-800' 
                          : 'text-neutral-600 hover:bg-neutral-100'
                        }
                      `}
                    >
                      <item.icon className="w-5 h-5" />
                      <span className="font-medium">{item.name}</span>
                    </Link>
                  );
                })}
              </nav>

              {user && (
                <div className="mt-8 pt-8 border-t border-neutral-200">
                  <div className="flex items-center gap-3 px-4 mb-4">
                    <div className="w-10 h-10 rounded bg-neutral-200 flex items-center justify-center">
                      <span className="text-neutral-600 font-medium">
                        {user.full_name?.[0] || user.email?.[0] || 'U'}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-neutral-900 truncate">
                        {user.full_name || 'User'}
                      </p>
                      <p className="text-xs text-neutral-500 truncate">{user.email}</p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    onClick={handleLogout}
                    className="w-full justify-start gap-3 text-red-600 hover:bg-red-50 hover:text-red-700"
                  >
                    <LogOut className="w-5 h-5" />
                    Sign Out
                  </Button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Desktop Sidebar */}
      <div className="hidden lg:flex lg:w-56 lg:flex-col lg:fixed lg:inset-y-0">
        <div className="flex flex-col flex-grow bg-white border-r border-neutral-200">
          {/* Logo */}
          <div className="px-6 py-6 border-b border-neutral-100">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded bg-gradient-to-br from-neutral-800 to-neutral-900 flex items-center justify-center -neutral-300">
                <Building2 className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="font-display font-semibold text-neutral-900 text-lg">PB Abbey</h1>
                <p className="text-xs text-neutral-500">Receipts & VAT</p>
              </div>
            </div>
          </div>

          {/* Navigation */}
          <nav className="flex-1 px-4 py-6 space-y-1">
            {filteredNav.map((item) => {
              const isActive = currentPageName === item.page;
              return (
                <Link
                  key={item.name}
                  to={item.path || createPageUrl(item.page)}
                  className={`
                    group flex items-center gap-3 px-4 py-3 rounded transition-all duration-200
                    ${isActive 
                      ? 'bg-neutral-50 text-neutral-800' 
                      : 'text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900'
                    }
                  `}
                >
                  <item.icon className={`w-5 h-5 transition-colors ${isActive ? 'text-neutral-900' : ''}`} />
                  <span className="font-medium">{item.name}</span>
                  {isActive && (
                    <ChevronRight className="w-4 h-4 ml-auto text-neutral-500" />
                  )}
                </Link>
              );
            })}
          </nav>

          {/* User Section */}
          {user && (
            <div className="p-4 border-t border-neutral-100">
              <div className="flex items-center gap-3 px-3 py-3 rounded bg-neutral-50">
                <div className="w-10 h-10 rounded bg-gradient-to-br from-neutral-200 to-neutral-300 flex items-center justify-center">
                  <span className="text-neutral-600 font-semibold">
                    {user.full_name?.[0] || user.email?.[0] || 'U'}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-neutral-900 truncate text-sm">
                    {user.full_name || 'User'}
                  </p>
                  <p className="text-xs text-neutral-500 truncate">{user.email}</p>
                </div>
                <button
                  onClick={handleLogout}
                  className="p-2 hover:bg-neutral-200 rounded-lg transition-colors"
                  title="Sign out"
                >
                  <LogOut className="w-4 h-4 text-neutral-500" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="lg:pl-56">
        <main className="pt-16 lg:pt-0">
          {children}
        </main>
      </div>
    </div>
  );
}