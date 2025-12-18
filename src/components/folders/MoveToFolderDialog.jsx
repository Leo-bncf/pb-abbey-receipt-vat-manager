import React, { useState } from 'react';
import { Folder, FolderOpen } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export default function MoveToFolderDialog({ 
  isOpen, 
  onClose, 
  folders = [], 
  onMove,
  receiptCount = 0 
}) {
  const [selectedFolderId, setSelectedFolderId] = useState(null);

  const folderColors = {
    blue: 'bg-blue-100 text-blue-700',
    green: 'bg-green-100 text-green-700',
    purple: 'bg-purple-100 text-purple-700',
    amber: 'bg-amber-100 text-amber-700',
    rose: 'bg-rose-100 text-rose-700',
    slate: 'bg-slate-100 text-slate-700'
  };

  const handleMove = () => {
    onMove(selectedFolderId);
    setSelectedFolderId(null);
    onClose();
  };

  const renderFolder = (folder, level = 0) => {
    const subfolders = folders.filter(f => f.parent_folder_id === folder.id);
    
    return (
      <div key={folder.id}>
        <button
          onClick={() => setSelectedFolderId(folder.id)}
          className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
            selectedFolderId === folder.id 
              ? 'bg-indigo-100 border-2 border-indigo-500' 
              : 'hover:bg-slate-50 border-2 border-transparent'
          }`}
          style={{ paddingLeft: `${level * 20 + 16}px` }}
        >
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${folderColors[folder.color || 'blue']}`}>
            {selectedFolderId === folder.id ? (
              <FolderOpen className="w-5 h-5" />
            ) : (
              <Folder className="w-5 h-5" />
            )}
          </div>
          <span className="flex-1 text-left font-medium text-slate-700">
            {folder.name}
          </span>
        </button>
        {subfolders.length > 0 && (
          <div className="ml-4">
            {subfolders.map(subfolder => renderFolder(subfolder, level + 1))}
          </div>
        )}
      </div>
    );
  };

  const rootFolders = folders.filter(f => !f.parent_folder_id);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Move {receiptCount} receipt{receiptCount !== 1 ? 's' : ''} to folder</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-2 max-h-96 overflow-y-auto py-2">
          {/* Root option */}
          <button
            onClick={() => setSelectedFolderId(null)}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
              selectedFolderId === null 
                ? 'bg-indigo-100 border-2 border-indigo-500' 
                : 'hover:bg-slate-50 border-2 border-transparent'
            }`}
          >
            <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center">
              <Folder className="w-5 h-5 text-slate-600" />
            </div>
            <span className="flex-1 text-left font-medium text-slate-700">
              All Receipts (Root)
            </span>
          </button>

          {rootFolders.map(folder => renderFolder(folder))}
        </div>

        <div className="flex gap-3 pt-4">
          <Button variant="outline" onClick={onClose} className="flex-1">
            Cancel
          </Button>
          <Button 
            onClick={handleMove} 
            className="flex-1 bg-indigo-600 hover:bg-indigo-700"
          >
            Move {receiptCount} receipt{receiptCount !== 1 ? 's' : ''}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}