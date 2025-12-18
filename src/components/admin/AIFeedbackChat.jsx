import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Bot, User, Loader2, Lightbulb, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { base44 } from '@/api/base44Client';

export default function AIFeedbackChat({ receiptContext, onFeedbackSaved }) {
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: 'Hello! I\'m here to learn from your corrections. You can teach me rules about VAT, vendor patterns, or explain why certain extractions were incorrect. What would you like me to learn?',
      timestamp: new Date()
    }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage = {
      role: 'user',
      content: input,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    // Build context for the AI
    let contextPrompt = `You are an AI assistant that helps improve receipt data extraction accuracy. 
    The user is providing feedback to help you learn patterns and rules.
    
    Current feedback: "${input}"
    `;

    if (receiptContext) {
      contextPrompt += `
      
      Context about the receipt being discussed:
      - Vendor: ${receiptContext.vendor_name || 'Unknown'}
      - Country: ${receiptContext.country || 'Unknown'}
      - Total: ${receiptContext.total_amount || 'Unknown'}
      - VAT: ${receiptContext.vat_amount || 'Unknown'}
      - VAT Rate: ${receiptContext.vat_rate || 'Unknown'}%
      `;
    }

    contextPrompt += `
    
    Respond briefly, acknowledging the feedback and explaining what rule or pattern you've learned.
    Also suggest if there are related patterns you should watch for.
    Keep your response concise and actionable.`;

    const response = await base44.integrations.Core.InvokeLLM({
      prompt: contextPrompt,
      response_json_schema: {
        type: 'object',
        properties: {
          response: { type: 'string', description: 'Your response to the user' },
          rule_learned: { type: 'string', description: 'The specific rule or pattern extracted from this feedback' },
          feedback_type: { type: 'string', enum: ['correction', 'rule', 'pattern', 'general'] }
        }
      }
    });

    const aiMessage = {
      role: 'assistant',
      content: response.response,
      ruleLearned: response.rule_learned,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, aiMessage]);
    setIsLoading(false);

    // Save the feedback to the database
    if (onFeedbackSaved) {
      await base44.entities.AIFeedback.create({
        receipt_id: receiptContext?.id || null,
        feedback_type: response.feedback_type || 'general',
        user_message: input,
        ai_response: response.response,
        rule_learned: response.rule_learned,
        is_applied: false
      });
      onFeedbackSaved();
    }
  };

  const quickPrompts = [
    'This vendor is always tax-free',
    'VAT was calculated incorrectly',
    'The date format is DD/MM/YYYY',
    'This is a recurring expense pattern'
  ];

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-200">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="font-semibold text-slate-800">AI Training Assistant</h2>
            <p className="text-xs text-slate-500">Teach me to improve extraction accuracy</p>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <AnimatePresence>
          {messages.map((message, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className={`flex gap-3 ${message.role === 'user' ? 'justify-end' : ''}`}
            >
              {message.role === 'assistant' && (
                <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center flex-shrink-0">
                  <Bot className="w-4 h-4 text-indigo-600" />
                </div>
              )}
              <div className={`max-w-[80%] ${message.role === 'user' ? 'order-first' : ''}`}>
                <div className={`rounded-2xl px-4 py-3 ${
                  message.role === 'user' 
                    ? 'bg-indigo-600 text-white rounded-br-md' 
                    : 'bg-slate-100 text-slate-800 rounded-bl-md'
                }`}>
                  <p className="text-sm">{message.content}</p>
                </div>
                {message.ruleLearned && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    className="mt-2 p-3 bg-green-50 rounded-xl border border-green-200"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Lightbulb className="w-4 h-4 text-green-600" />
                      <span className="text-xs font-medium text-green-800">Rule Learned</span>
                    </div>
                    <p className="text-sm text-green-700">{message.ruleLearned}</p>
                  </motion.div>
                )}
              </div>
              {message.role === 'user' && (
                <div className="w-8 h-8 rounded-lg bg-slate-200 flex items-center justify-center flex-shrink-0">
                  <User className="w-4 h-4 text-slate-600" />
                </div>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
        
        {isLoading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex gap-3"
          >
            <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center">
              <Bot className="w-4 h-4 text-indigo-600" />
            </div>
            <div className="bg-slate-100 rounded-2xl rounded-bl-md px-4 py-3">
              <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
            </div>
          </motion.div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Quick Prompts */}
      <div className="px-4 py-2 border-t border-slate-100">
        <div className="flex gap-2 overflow-x-auto pb-2">
          {quickPrompts.map((prompt, index) => (
            <Badge
              key={index}
              variant="outline"
              className="cursor-pointer hover:bg-slate-100 transition-colors whitespace-nowrap"
              onClick={() => setInput(prompt)}
            >
              {prompt}
            </Badge>
          ))}
        </div>
      </div>

      {/* Input */}
      <div className="p-4 border-t border-slate-200">
        <div className="flex gap-3">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Teach me about this receipt..."
            className="resize-none min-h-[44px] max-h-32"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
          />
          <Button
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
            className="bg-indigo-600 hover:bg-indigo-700 h-auto"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}