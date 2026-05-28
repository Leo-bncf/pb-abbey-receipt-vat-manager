import React, { useState } from 'react';
import { FolderPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { base44 } from '@/api/base44Client';
import { useMutation, useQueryClient } from '@tanstack/react-query';

export default function FolderManager({ folders = [], currentFolderId }) {
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState('blue');
  const [parentFolderId, setParentFolderId] = useState('');
  const queryClient = useQueryClient();

  const createFolderMutation = useMutation({
    mutationFn: (data) => base44.entities.Folder.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['folders'] });
      setIsOpen(false);
      setName('');
      setDescription('');
      setColor('blue');
      setParentFolderId('');
    },
  });

  const handleCreate = () => {
    if (!name.trim()) return;
    
    createFolderMutation.mutate({
      name: name.trim(),
      description: description.trim() || undefined,
      color,
      parent_folder_id: parentFolderId || undefined
    });
  };

  const colors = [
    { value: 'blue', label: 'Blue', class: 'bg-blue-500' },
    { value: 'green', label: 'Green', class: 'bg-green-500' },
    { value: 'purple', label: 'Purple', class: 'bg-purple-500' },
    { value: 'amber', label: 'Amber', class: 'bg-amber-500' },
    { value: 'rose', label: 'Rose', class: 'bg-rose-500' },
    { value: 'slate', label: 'Slate', class: 'bg-slate-500' }
  ];

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-2">
          <FolderPlus className="w-4 h-4" />
          New Folder
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create New Folder</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-4">
          <div>
            <label className="text-sm font-medium text-slate-700 block mb-2">
              Folder Name
            </label>
            <Input
              placeholder="e.g., 2024 Receipts"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>

          <div>
            <label className="text-sm font-medium text-slate-700 block mb-2">
              Description (optional)
            </label>
            <Textarea
              placeholder="Add a description..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>

          <div>
            <label className="text-sm font-medium text-slate-700 block mb-2">
              Color
            </label>
            <div className="grid grid-cols-6 gap-2">
              {colors.map(c => (
                <button
                  key={c.value}
                  onClick={() => setColor(c.value)}
                  className={`w-full h-10 rounded-lg ${c.class} ${
                    color === c.value ? 'ring-2 ring-offset-2 ring-slate-400' : ''
                  }`}
                  title={c.label}
                />
              ))}
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-slate-700 block mb-2">
              Parent Folder (optional)
            </label>
            <Select value={parentFolderId} onValueChange={setParentFolderId}>
              <SelectTrigger>
                <SelectValue placeholder="Root (no parent)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={null}>Root (no parent)</SelectItem>
                {folders.filter(f => f.id !== currentFolderId).map(folder => (
                  <SelectItem key={folder.id} value={folder.id}>
                    {folder.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex gap-3 pt-2">
            <Button
              variant="outline"
              onClick={() => setIsOpen(false)}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!name.trim() || createFolderMutation.isPending}
              className="flex-1 bg-indigo-600 hover:bg-indigo-700"
            >
              Create Folder
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}