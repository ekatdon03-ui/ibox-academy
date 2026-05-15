import React, { useState, useEffect } from 'react';
import { Book, Search, Filter, ChevronDown } from 'lucide-react';
import { motion } from 'motion/react';
import { contentService } from '../services/contentService';
import { GlossaryTerm } from '../types';

export default function GlossaryView() {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ВСЕ');
  const [terms, setTerms] = useState<GlossaryTerm[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadGlossary = async () => {
      try {
        const data = await contentService.getGlossary();
        setTerms(data);
      } catch (e) {
        console.error("Glossary load failed:", e);
      } finally {
        setIsLoading(false);
      }
    };
    loadGlossary();
  }, []);

  const categories = ['ВСЕ', ...new Set(terms.map(item => item.category))];

  const filteredItems = terms
    .filter(item => {
      const matchesSearch = item.term.toLowerCase().includes(searchTerm.toLowerCase()) || 
                           item.definition.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesCategory = selectedCategory === 'ВСЕ' || item.category === selectedCategory;
      return matchesSearch && matchesCategory;
    })
    .sort((a, b) => a.term.localeCompare(b.term));

  return (
    <div className="flex-1 overflow-y-auto p-10 bg-ibox-bg h-full">
      <div className="max-w-7xl mx-auto pb-24">
        <header className="mb-16">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-8 mb-8">
            <div>
              <h2 className="text-5xl font-display font-black uppercase tracking-tight text-[#002D57] leading-none">Глоссарий</h2>
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#00A3FF] mt-4">Единый словарь терминов и определений iBOX Academy</p>
            </div>
            <div className="flex flex-wrap gap-2 bg-white p-2 rounded-3xl border border-gray-100 shadow-sm max-w-full">
               {categories.map(cat => (
                 <button 
                  key={cat} 
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all ${cat === selectedCategory ? 'bg-[#002D57] text-white' : 'text-gray-400 hover:text-[#002D57]'}`}
                 >
                   {cat}
                 </button>
               ))}
            </div>
          </div>
        </header>

        <div className="mb-16 relative">
          <div className="absolute left-10 top-1/2 -translate-y-1/2 text-gray-300">
            <Search size={32} />
          </div>
          <input 
            type="text" 
            placeholder="Я ИЩУ ТЕРМИН..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-white rounded-[48px] py-10 pl-24 pr-12 outline-none border border-gray-100 shadow-2xl text-2xl font-display font-black placeholder:text-gray-200 uppercase tracking-tight focus:ring-8 focus:ring-[#00A3FF]/10 transition-all"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {filteredItems.map((item, idx) => (
            <motion.div 
              key={`${item.id || item.term}-${idx}`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.05 }}
              className="bg-white p-10 rounded-[48px] border border-gray-100 shadow-sm hover:shadow-2xl transition-all group"
            >
              <div className="flex items-center justify-between mb-8">
                <div className="w-14 h-14 bg-gray-50 border border-gray-100 text-[#002D57] rounded-3xl flex items-center justify-center group-hover:bg-[#00A3FF] group-hover:text-white transition-all shadow-sm">
                  <Book size={24} />
                </div>
                <span className="text-[10px] font-black uppercase tracking-widest text-[#00A3FF] bg-[#00A3FF]/5 px-4 py-2 rounded-xl border border-[#00A3FF]/10">{item.category}</span>
              </div>
              <h3 className="text-3xl font-display font-black uppercase tracking-tight text-[#002D57] mb-4">{item.term}</h3>
              <p className="text-gray-500 leading-relaxed font-bold text-lg">
                {item.definition}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}
