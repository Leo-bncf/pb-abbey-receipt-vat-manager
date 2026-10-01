import React from 'react';
import { motion } from 'framer-motion';

export default function StatsCard({ title, value, subtitle, icon: Icon, color = 'indigo', index = 0 }) {
  const bgColors = {
    indigo: 'bg-neutral-50',
    emerald: 'bg-emerald-50',
    amber: 'bg-amber-50',
    rose: 'bg-rose-50',
    blue: 'bg-blue-50',
    purple: 'bg-neutral-50',
  };

  const iconColors = {
    indigo: 'text-neutral-900',
    emerald: 'text-emerald-600',
    amber: 'text-amber-600',
    rose: 'text-rose-600',
    blue: 'text-blue-600',
    purple: 'text-neutral-900',
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.1 }}
      className="bg-white rounded border border-neutral-200 p-6 hover: hover:border-neutral-300 transition-all duration-300"
    >
      <div className="flex items-start justify-between mb-4">
        <div className={`w-12 h-12 rounded ${bgColors[color]} flex items-center justify-center`}>
          <Icon className={`w-6 h-6 ${iconColors[color]}`} />
        </div>
      </div>
      <div>
        <p className="text-sm text-neutral-500 mb-1">{title}</p>
        <p className="text-3xl font-bold text-neutral-900">{value}</p>
        {subtitle && (
          <p className="text-sm text-neutral-400 mt-1">{subtitle}</p>
        )}
      </div>
    </motion.div>
  );
}