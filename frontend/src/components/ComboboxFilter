// frontend/src/components/ComboboxFilter.jsx
import React, { useState, useRef, useEffect } from 'react';

export default function ComboboxFilter({
    label,
    value,
    options = [],
    onChange,
    placeholder = 'Type to search...',
    clearLabel = `All`,
    className = ''
}) {
    const [isOpen, setIsOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [highlightedIndex, setHighlightedIndex] = useState(-1);
    const containerRef = useRef(null);
    const inputRef = useRef(null);

    // Update search term when value changes from parent
    useEffect(() => {
        setSearchTerm(value || '');
    }, [value]);

    // Filter options based on search term
    const filteredOptions = options.filter(opt =>
        opt.toLowerCase().includes(searchTerm.toLowerCase())
    );

    // Handle selecting an option
    const handleSelect = (selected) => {
        setSearchTerm(selected);
        onChange(selected);
        setIsOpen(false);
        setHighlightedIndex(-1);
        inputRef.current?.blur();
    };

    // Handle clearing the selection
    const handleClear = () => {
        setSearchTerm('');
        onChange('');
        setIsOpen(false);
        setHighlightedIndex(-1);
        inputRef.current?.focus();
    };

    // Handle keyboard navigation
    const handleKeyDown = (e) => {
        if (!isOpen && filteredOptions.length > 0 && e.key === 'ArrowDown') {
            setIsOpen(true);
            return;
        }

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHighlightedIndex(prev =>
                prev < filteredOptions.length - 1 ? prev + 1 : prev
            );
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlightedIndex(prev => (prev > -1 ? prev - 1 : -1));
        } else if (e.key === 'Enter' && highlightedIndex >= 0) {
            e.preventDefault();
            if (highlightedIndex === -1) {
                // If no option highlighted, use the first filtered option
                if (filteredOptions.length > 0) {
                    handleSelect(filteredOptions[0]);
                }
            } else {
                handleSelect(filteredOptions[highlightedIndex]);
            }
        } else if (e.key === 'Escape') {
            setIsOpen(false);
            setHighlightedIndex(-1);
        } else if (e.key === 'Backspace' && searchTerm === '') {
            handleClear();
        }
    };

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (containerRef.current && !containerRef.current.contains(event.target)) {
                setIsOpen(false);
                setHighlightedIndex(-1);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    return (
        <div className={`combobox-container ${className}`} ref={containerRef}>
            <div className="combobox-input-wrapper">
                <input
                    ref={inputRef}
                    type="text"
                    className="combobox-input"
                    placeholder={placeholder}
                    value={searchTerm}
                    onChange={(e) => {
                        setSearchTerm(e.target.value);
                        onChange(e.target.value);
                        setIsOpen(true);
                        setHighlightedIndex(-1);
                    }}
                    onFocus={() => {
                        if (options.length > 0) {
                            setIsOpen(true);
                        }
                    }}
                    onKeyDown={handleKeyDown}
                    autoComplete="off"
                />
                {searchTerm && (
                    <button
                        className="combobox-clear-btn"
                        onClick={handleClear}
                        type="button"
                        aria-label="Clear selection"
                    >
                        ✕
                    </button>
                )}
                <button
                    className="combobox-toggle-btn"
                    onClick={() => setIsOpen(!isOpen)}
                    type="button"
                    aria-label="Toggle dropdown"
                >
                    ▾
                </button>
            </div>

            {isOpen && filteredOptions.length > 0 && (
                <div className="combobox-dropdown">
                    {/* "All" option */}
                    <div
                        className={`combobox-option combobox-option-all ${!value ? 'active' : ''}`}
                        onClick={handleClear}
                    >
                         All {label}s
                    </div>

                    {/* Filtered options */}
                    {filteredOptions.map((option, index) => (
                        <div
                            key={option}
                            className={`combobox-option ${index === highlightedIndex ? 'highlighted' : ''} ${value === option ? 'selected' : ''}`}
                            onClick={() => handleSelect(option)}
                            onMouseEnter={() => setHighlightedIndex(index)}
                        >
                            {value === option && '✓ '}
                            {option}
                        </div>
                    ))}
                </div>
            )}

            {isOpen && filteredOptions.length === 0 && (
                <div className="combobox-dropdown">
                    <div className="combobox-no-results">
                        No matching {label.toLowerCase()}s found
                    </div>
                </div>
            )}
        </div>
    );
}