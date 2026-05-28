import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Folder, FolderOpen, ChevronRight, ChevronDown, Trash2, Edit2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';

export default function FolderTree({ 
  folders = [], 
  receipts = [],
  currentFolderId, 
  onSelectFolder,
  expandedFolders = [],
  onToggleFolder,
  onDeleteFolder,
  onRenameFolder
}) {
  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState('');
  const folderColors = {
    blue: 'bg-blue-100 text-blue-700',
    green: 'bg-green-100 text-green-700',
    purple: 'bg-purple-100 text-purple-700',
    amber: 'bg-amber-100 text-amber-700',
    rose: 'bg-rose-100 text-rose-700',
    slate: 'bg-slate-100 text-slate-700'
  };

  const getReceiptCount = (folderId) => {
    return receipts.filter(r => r.folder_id === folderId).length;
  };

  const getSubfolders = (parentId) => {
    return folders.filter(f => f.parent_folder_id === parentId);
  };

  const handleStartEdit = (folder, e) => {
    e.stopPropagation();
    setEditingId(folder.id);
    setEditingName(folder.name);
  };

  const handleSaveEdit = (folderId, e) => {
    e.stopPropagation();
    if (editingName.trim() && editingName !== folders.find(f => f.id === folderId)?.name) {
      onRenameFolder(folderId, editingName.trim());
    }
    setEditingId(null);
    setEditingName('');
  };

  const handleCancelEdit = (e) => {
    e.stopPropagation();
    setEditingId(null);
    setEditingName('');
  };

  const renderFolder = (folder, level = 0) => {
    const subfolders = getSubfolders(folder.id);
    const hasSubfolders = subfolders.length > 0;
    const isExpanded = expandedFolders.includes(folder.id);
    const isSelected = currentFolderId === folder.id;
    const receiptCount = getReceiptCount(folder.id);
    const isEditing = editingId === folder.id;

    return (
      <div key={folder.id}>
        <motion.div
          className={`group w-full flex items-center gap-2 px-3 py-2.5 rounded-lg transition-colors ${
            isSelected ? 'bg-indigo-50 text-indigo-700' : 'hover:bg-slate-50'
          }`}
          style={{ paddingLeft: `${level * 20 + 12}px` }}
          whileHover={{ x: 2 }}
        >
          {hasSubfolders && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleFolder(folder.id);
              }}
              className="p-0.5"
            >
              {isExpanded ? (
                <ChevronDown className="w-4 h-4 text-slate-400" />
              ) : (
                <ChevronRight className="w-4 h-4 text-slate-400" />
              )}
            </button>
          )}
          {!hasSubfolders && <div className="w-5" />}
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${folderColors[folder.color || 'blue']}`}>
            {isSelected ? (
              <FolderOpen className="w-5 h-5" />
            ) : (
              <Folder className="w-5 h-5" />
            )}
          </div>
          {isEditing ? (
            <div className="flex-1 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
              <Input
                value={editingName}
                onChange={(e) => setEditingName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveEdit(folder.id, e);
                  if (e.key === 'Escape') handleCancelEdit(e);
                }}
                className="h-7 text-sm"
                autoFocus
              />
              <button
                onClick={(e) => handleSaveEdit(folder.id, e)}
                className="px-2 py-1 bg-green-500 text-white text-xs rounded hover:bg-green-600"
              >
                Save
              </button>
            </div>
          ) : (
            <>
              <button
                onClick={() => onSelectFolder(folder.id)}
                className="flex-1 text-left text-sm font-medium text-slate-700"
              >
                {folder.name}
              </button>
              {receiptCount > 0 && (
                <Badge variant="outline" className="text-xs px-2">
                  {receiptCount}
                </Badge>
              )}
              <button
                onClick={(e) => handleStartEdit(folder, e)}
                className="p-1 hover:bg-blue-100 rounded opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <Edit2 className="w-3 h-3 text-blue-500" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Delete folder "${folder.name}"?${receiptCount > 0 ? ` It contains ${receiptCount} receipt(s).` : ''}`)) {
                    onDeleteFolder(folder.id);
                  }
                }}
                className="p-1 hover:bg-red-100 rounded opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <Trash2 className="w-3 h-3 text-red-500" />
              </button>
            </>
          )}
        </motion.div>
        {hasSubfolders && isExpanded && (
          <div>
            {subfolders.map(subfolder => renderFolder(subfolder, level + 1))}
          </div>
        )}
      </div>
    );
  };

  const rootFolders = folders.filter(f => !f.parent_folder_id);

  return (
    <div className="space-y-1">
      {rootFolders.map(folder => renderFolder(folder))}
    </div>
  );
}