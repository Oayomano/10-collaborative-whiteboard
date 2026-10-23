import React, { useState, useEffect, useRef } from 'react';
import { supabase, getStoredElements, saveElementToDb, deleteElementFromDb } from './supabaseClient';

const PALETTE = [
  '#2563eb', '#3b82f6', '#06b6d4', '#10b981',
  '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6',
  '#0f172a', '#64748b', '#a7f3d0', '#fecdd3'
];

export default function App() {
  const params = new URLSearchParams(window.location.search);
  const initialRoom = params.get('room') || 'room-alpha';

  // Board Tabs & Board Meta State
  const [openBoards, setOpenBoards] = useState([
    { id: initialRoom, title: 'Project Planning' }
  ]);
  const [activeBoardId, setActiveBoardId] = useState(initialRoom);
  const [isEditingTitle, setIsEditingTitle] = useState(false);

  // Canvas & Sync State
  const [elements, setElements] = useState([]);
  const [activeTool, setActiveTool] = useState('select');
  const [selectedColor, setSelectedColor] = useState('#2563eb');
  const [zoom, setZoom] = useState(100);
  const [onlineCount, setOnlineCount] = useState(1);
  const [copiedLink, setCopiedLink] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [cursors, setCursors] = useState({});
  const [selectedId, setSelectedId] = useState(null);

  // Interaction References
  const [draggingId, setDraggingId] = useState(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [resizingId, setResizingId] = useState(null);
  const [resizeData, setResizeData] = useState({ startX: 0, startY: 0, startW: 0, startH: 0 });
  const [currentLine, setCurrentLine] = useState(null);

  const channelRef = useRef(null);
  const canvasRef = useRef(null);
  const myUserId = useRef('user-' + Math.floor(Math.random() * 10000)).current;

  // Active Board Object
  const currentBoard = openBoards.find((b) => b.id === activeBoardId) || openBoards[0];

  // 1. Supabase Initialization per Board Room
  useEffect(() => {
    // Keep URL parameter aligned with active tab
    const newUrl = `${window.location.pathname}?room=${activeBoardId}`;
    window.history.replaceState(null, '', newUrl);

    getStoredElements(activeBoardId).then((loaded) => setElements(loaded || []));

    const channel = supabase.channel(`board:${activeBoardId}`, {
      config: { broadcast: { self: false }, presence: { key: myUserId } }
    });

    channel.on('broadcast', { event: 'element:update' }, ({ payload }) => {
      setElements((prev) => {
        const idx = prev.findIndex((el) => el.id === payload.id);
        if (idx !== -1) {
          const next = [...prev];
          next[idx] = payload;
          return next;
        }
        return [...prev, payload];
      });
    });

    channel.on('broadcast', { event: 'element:delete' }, ({ payload }) => {
      setElements((prev) => prev.filter((el) => el.id !== payload.id));
    });

    channel.on('broadcast', { event: 'board:title' }, ({ payload }) => {
      setOpenBoards((prev) =>
        prev.map((b) => (b.id === payload.id ? { ...b, title: payload.title } : b))
      );
    });

    channel.on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState();
      const remoteCursorMap = {};
      Object.keys(state).forEach((key) => {
        state[key].forEach((peer) => {
          if (peer.id !== myUserId && peer.x !== undefined) {
            remoteCursorMap[peer.id] = peer;
          }
        });
      });
      setOnlineCount(Math.max(1, Object.keys(state).length));
      setCursors(remoteCursorMap);
    });

    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        setIsConnected(true);
        channel.track({ id: myUserId, color: selectedColor });
      }
    });

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeBoardId]);

  // 2. Broadcast Helpers
  const broadcastUpdate = (elem) => {
    if (channelRef.current && isConnected) {
      channelRef.current.send({
        type: 'broadcast',
        event: 'element:update',
        payload: elem
      });
    }
  };

  const broadcastDelete = (id) => {
    if (channelRef.current && isConnected) {
      channelRef.current.send({
        type: 'broadcast',
        event: 'element:delete',
        payload: { id }
      });
    }
  };

  const getCanvasCoords = (clientX, clientY) => {
    if (!canvasRef.current) return { x: clientX, y: clientY };
    const rect = canvasRef.current.getBoundingClientRect();
    const scale = zoom / 100;
    return {
      x: (clientX - rect.left) / scale,
      y: (clientY - rect.top) / scale
    };
  };

  // 3. Canvas Mouse / Pointer Handlers
  const handlePointerDownCanvas = (e) => {
    if (e.target !== canvasRef.current && activeTool !== 'draw') return;

    setSelectedId(null);
    const { x, y } = getCanvasCoords(e.clientX, e.clientY);

    if (activeTool === 'draw') {
      const newLine = {
        id: 'line-' + Date.now(),
        type: 'draw',
        points: [{ x, y }],
        color: selectedColor,
        strokeWidth: 3
      };
      setCurrentLine(newLine);
    } else if (
      activeTool === 'rectangle' ||
      activeTool === 'circle' ||
      activeTool === 'triangle' ||
      activeTool === 'sticky_note' ||
      activeTool === 'text'
    ) {
      const isTri = activeTool === 'triangle';
      const isNote = activeTool === 'sticky_note';

      const newElem = {
        id: 'elem-' + Date.now(),
        type: activeTool,
        x: x - (isTri ? 100 : 80),
        y: y - (isTri ? 90 : 60),
        width: isTri ? 200 : isNote ? 160 : 150,
        height: isTri ? 180 : isNote ? 160 : 100,
        color: isNote ? '#fef08a' : selectedColor,
        text:
          isNote
            ? 'Plan\nthe next\nsprint'
            : activeTool === 'rectangle'
            ? 'Research'
            : activeTool === 'circle'
            ? 'Design'
            : isTri
            ? 'Sprint Goal'
            : 'Click to type...'
      };
      setElements((prev) => [...prev, newElem]);
      setSelectedId(newElem.id);
      saveElementToDb(newElem, activeBoardId);
      broadcastUpdate(newElem);
      setActiveTool('select');
    }
  };

  const handlePointerMove = (e) => {
    if (channelRef.current && isConnected) {
      channelRef.current.track({
        id: myUserId,
        x: e.clientX,
        y: e.clientY,
        color: selectedColor
      });
    }

    const { x, y } = getCanvasCoords(e.clientX, e.clientY);

    if (currentLine) {
      const updatedLine = { ...currentLine, points: [...currentLine.points, { x, y }] };
      setCurrentLine(updatedLine);
      broadcastUpdate(updatedLine);
      return;
    }

    if (resizingId) {
      const scale = zoom / 100;
      const dx = (e.clientX - resizeData.startX) / scale;
      const dy = (e.clientY - resizeData.startY) / scale;
      const target = elements.find((el) => el.id === resizingId);
      const isTri = target?.type === 'triangle';

      const nextW = Math.max(isTri ? 140 : 80, resizeData.startW + dx);
      const nextH = Math.max(isTri ? 120 : 60, resizeData.startH + dy);

      setElements((prev) =>
        prev.map((el) => (el.id === resizingId ? { ...el, width: nextW, height: nextH } : el))
      );

      if (target) {
        broadcastUpdate({ ...target, width: nextW, height: nextH });
      }
      return;
    }

    if (draggingId && activeTool === 'select') {
      const nextX = x - dragOffset.x;
      const nextY = y - dragOffset.y;

      setElements((prev) =>
        prev.map((el) => (el.id === draggingId ? { ...el, x: nextX, y: nextY } : el))
      );

      const target = elements.find((el) => el.id === draggingId);
      if (target) {
        broadcastUpdate({ ...target, x: nextX, y: nextY });
      }
    }
  };

  const handlePointerUp = () => {
    if (currentLine) {
      setElements((prev) => [...prev, currentLine]);
      saveElementToDb(currentLine, activeBoardId);
      setCurrentLine(null);
    }
    if (draggingId) {
      const target = elements.find((el) => el.id === draggingId);
      if (target) saveElementToDb(target, activeBoardId);
      setDraggingId(null);
    }
    if (resizingId) {
      const target = elements.find((el) => el.id === resizingId);
      if (target) saveElementToDb(target, activeBoardId);
      setResizingId(null);
    }
  };

  // 4. Eraser & Deletion Logic (Works for lines, shapes, and notes)
  const handleDeleteItem = (id, e) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    setElements((prev) => prev.filter((item) => item.id !== id));
    if (selectedId === id) setSelectedId(null);
    deleteElementFromDb(id);
    broadcastDelete(id);
  };

  const handleElementInteraction = (elem, e) => {
    if (activeTool === 'eraser') {
      handleDeleteItem(elem.id, e);
      return;
    }

    if (activeTool === 'select') {
      e.stopPropagation();
      setSelectedId(elem.id);
      const { x, y } = getCanvasCoords(e.clientX, e.clientY);
      setDraggingId(elem.id);
      setDragOffset({ x: x - elem.x, y: y - elem.y });
    }
  };

  const handleTextChange = (id, nextText) => {
    setElements((prev) =>
      prev.map((el) => (el.id === id ? { ...el, text: nextText } : el))
    );
    const target = elements.find((el) => el.id === id);
    if (target) {
      const updated = { ...target, text: nextText };
      saveElementToDb(updated, activeBoardId);
      broadcastUpdate(updated);
    }
  };

  // 5. Board Tabs & Editable Title Management
  const handleAddNewBoard = () => {
    const newId = 'room-' + Math.random().toString(36).substring(2, 7);
    const newBoard = { id: newId, title: `Board ${openBoards.length + 1}` };
    setOpenBoards((prev) => [...prev, newBoard]);
    setActiveBoardId(newId);
  };

  const handleCloseBoard = (boardIdToClose, e) => {
    e.stopPropagation();
    if (openBoards.length <= 1) return; // Keep at least one tab open

    const remaining = openBoards.filter((b) => b.id !== boardIdToClose);
    setOpenBoards(remaining);

    if (activeBoardId === boardIdToClose) {
      setActiveBoardId(remaining[remaining.length - 1].id);
    }
  };

  const handleUpdateTitle = (newTitle) => {
    setOpenBoards((prev) =>
      prev.map((b) => (b.id === activeBoardId ? { ...b, title: newTitle } : b))
    );
    if (channelRef.current && isConnected) {
      channelRef.current.send({
        type: 'broadcast',
        event: 'board:title',
        payload: { id: activeBoardId, title: newTitle }
      });
    }
  };

  const handleCopyLink = () => {
    const url = `${window.location.origin}${window.location.pathname}?room=${activeBoardId}`;
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2200);
  };

  return (
    <div
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      style={{
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: '#f8fafc',
        userSelect: 'none',
        fontFamily: 'Inter, system-ui, -apple-system, sans-serif'
      }}
    >
      {/* ── TOP HEADER (Multi-Board Tabs + Editable Title + Collaboration Status) ── */}
      <header
        style={{
          height: '56px',
          borderBottom: '1px solid #e2e8f0',
          background: '#ffffff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 16px',
          zIndex: 50,
          boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.02)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 32,
              height: 32,
              background: '#4f46e5',
              borderRadius: 8,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ffffff',
              fontSize: 16,
              boxShadow: '0 2px 4px rgba(79, 70, 229, 0.25)'
            }}
          >
            📐
          </div>
          <span style={{ fontWeight: 700, fontSize: 15, color: '#0f172a', marginRight: 6 }}>
            Team Whiteboard
          </span>

          {/* Board Tabs */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {openBoards.map((b) => {
              const isActive = b.id === activeBoardId;
              return (
                <div
                  key={b.id}
                  onClick={() => setActiveBoardId(b.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '5px 10px',
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: isActive ? 600 : 500,
                    cursor: 'pointer',
                    background: isActive ? '#eff6ff' : '#f8fafc',
                    color: isActive ? '#2563eb' : '#64748b',
                    border: isActive ? '1px solid #bfdbfe' : '1px solid #e2e8f0',
                    transition: 'all 0.15s ease'
                  }}
                >
                  {/* Inline Editable Title for active board */}
                  {isActive && isEditingTitle ? (
                    <input
                      autoFocus
                      type="text"
                      value={b.title}
                      onChange={(e) => handleUpdateTitle(e.target.value)}
                      onBlur={() => setIsEditingTitle(false)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') setIsEditingTitle(false);
                      }}
                      style={{
                        border: 'none',
                        background: 'transparent',
                        outline: 'none',
                        fontSize: 12,
                        fontWeight: 600,
                        color: '#2563eb',
                        width: Math.max(70, b.title.length * 8) + 'px'
                      }}
                    />
                  ) : (
                    <span
                      title="Double-click to rename"
                      onDoubleClick={() => setIsEditingTitle(true)}
                    >
                      {b.title}
                    </span>
                  )}

                  {/* Close Tab Option (✕) */}
                  {openBoards.length > 1 && (
                    <span
                      onClick={(e) => handleCloseBoard(b.id, e)}
                      title="Close board tab"
                      style={{
                        marginLeft: 4,
                        fontSize: 13,
                        lineHeight: 1,
                        padding: '1px 3px',
                        borderRadius: 4,
                        color: isActive ? '#3b82f6' : '#94a3b8',
                        cursor: 'pointer'
                      }}
                    >
                      ✕
                    </span>
                  )}
                </div>
              );
            })}

            <button onClick={handleAddNewBoard} style={btnSecondary}>
              + New Board
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: isConnected ? '#16a34a' : '#ea580c', fontWeight: 500 }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: isConnected ? '#16a34a' : '#ea580c',
                boxShadow: isConnected ? '0 0 0 2px rgba(22, 163, 74, 0.2)' : 'none'
              }}
            />
            {isConnected ? `Live Sync Active (${onlineCount} online)` : 'Connecting...'}
          </div>

          <button onClick={handleCopyLink} style={{ ...btnPrimary, background: copiedLink ? '#059669' : '#10b981' }}>
            🔗 {copiedLink ? 'Link Copied!' : 'Copy Share Link'}
          </button>
        </div>
      </header>

      {/* ── WORKSPACE ── */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        
        {/* Floating Sidebar */}
        <aside
          style={{
            position: 'absolute',
            top: 20,
            left: 20,
            zIndex: 40,
            width: 148,
            background: '#ffffff',
            borderRadius: 12,
            padding: 8,
            boxShadow: '0 10px 25px -5px rgba(15, 23, 42, 0.08), 0 4px 6px -2px rgba(15, 23, 42, 0.03)',
            border: '1px solid #e2e8f0'
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {[
              { id: 'select', label: 'Select', icon: '↖' },
              { id: 'draw', label: 'Draw', icon: '✏️' },
              { id: 'rectangle', label: 'Rectangle', icon: '▢' },
              { id: 'circle', label: 'Circle', icon: '◯' },
              { id: 'triangle', label: 'Triangle', icon: '△' },
              { id: 'text', label: 'Text', icon: 'T' },
              { id: 'sticky_note', label: 'Sticky Note', icon: '📄' },
              { id: 'eraser', label: 'Eraser', icon: '🧹' }
            ].map((t) => {
              const isActive = activeTool === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setActiveTool(t.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '8px 10px',
                    borderRadius: 8,
                    border: 'none',
                    fontSize: 13,
                    fontWeight: isActive ? 600 : 500,
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'all 0.1s ease',
                    background: isActive ? '#eff6ff' : 'transparent',
                    color: isActive ? '#2563eb' : '#475569'
                  }}
                >
                  <span style={{ fontSize: 14, width: 16, textAlign: 'center' }}>{t.icon}</span>
                  {t.label}
                </button>
              );
            })}
          </div>

          <div style={{ fontSize: 10, color: '#94a3b8', margin: '14px 0 8px 8px', fontWeight: 700, letterSpacing: '0.04em' }}>
            COLOR PALETTE
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, padding: '0 4px 4px' }}>
            {PALETTE.map((c) => (
              <div
                key={c}
                onClick={() => setSelectedColor(c)}
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: '50%',
                  background: c,
                  cursor: 'pointer',
                  border: selectedColor === c ? '2px solid #0f172a' : '2px solid transparent',
                  transform: selectedColor === c ? 'scale(1.12)' : 'scale(1)',
                  transition: 'transform 0.1s ease',
                  boxSizing: 'border-box'
                }}
              />
            ))}
          </div>
        </aside>

        {/* Zoom Bar */}
        <div
          style={{
            position: 'absolute',
            top: 20,
            right: 20,
            zIndex: 40,
            background: '#ffffff',
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            padding: '3px 8px',
            gap: 6,
            boxShadow: '0 4px 12px rgba(15, 23, 42, 0.05)',
            border: '1px solid #e2e8f0'
          }}
        >
          <button onClick={() => setElements([])} title="Clear Canvas" style={zoomActionBtn}>↶</button>
          <button onClick={() => {}} title="Redo" style={zoomActionBtn}>↷</button>
          <div style={{ width: 1, height: 16, background: '#cbd5e1', margin: '0 2px' }} />
          <button onClick={() => setZoom((z) => Math.max(50, z - 10))} style={zoomActionBtn}>-</button>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#475569', minWidth: 38, textAlign: 'center' }}>
            {zoom}%
          </span>
          <button onClick={() => setZoom((z) => Math.min(200, z + 10))} style={zoomActionBtn}>+</button>
        </div>

        {/* ── CANVAS SURFACE ── */}
        <div
          ref={canvasRef}
          onPointerDown={handlePointerDownCanvas}
          style={{
            width: '100%',
            height: '100%',
            position: 'absolute',
            top: 0,
            left: 0,
            cursor:
              activeTool === 'draw'
                ? 'crosshair'
                : activeTool === 'eraser'
                ? 'pointer'
                : 'default',
            backgroundImage: 'radial-gradient(#cbd5e1 1.2px, transparent 1.2px)',
            backgroundSize: `${22 * (zoom / 100)}px ${22 * (zoom / 100)}px`,
            transform: `scale(${zoom / 100})`,
            transformOrigin: '0 0'
          }}
        >
          {/* SVG Pen Drawing Layer */}
          <svg
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              zIndex: 15,
              pointerEvents: activeTool === 'eraser' ? 'auto' : 'none'
            }}
          >
            {elements
              .filter((el) => el.type === 'draw')
              .map((line) => {
                const pts = line.points.map((p) => `${p.x},${p.y}`).join(' ');
                return (
                  <g key={line.id}>
                    {/* Invisible widened hit target to ensure effortless erasure */}
                    {activeTool === 'eraser' && (
                      <polyline
                        points={pts}
                        fill="none"
                        stroke="transparent"
                        strokeWidth={Math.max(16, (line.strokeWidth || 3) + 12)}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        style={{ cursor: 'pointer', pointerEvents: 'stroke' }}
                        onClick={(e) => handleDeleteItem(line.id, e)}
                      />
                    )}
                    {/* Rendered visible line */}
                    <polyline
                      points={pts}
                      fill="none"
                      stroke={line.color}
                      strokeWidth={line.strokeWidth || 3}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      style={{
                        cursor: activeTool === 'eraser' ? 'pointer' : 'default',
                        pointerEvents: activeTool === 'eraser' ? 'stroke' : 'none'
                      }}
                      onClick={(e) => {
                        if (activeTool === 'eraser') handleDeleteItem(line.id, e);
                      }}
                    />
                  </g>
                );
              })}

            {/* Currently drawing line */}
            {currentLine && (
              <polyline
                points={currentLine.points.map((p) => `${p.x},${p.y}`).join(' ')}
                fill="none"
                stroke={currentLine.color}
                strokeWidth={3}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
          </svg>

          {/* Canvas Elements (Sticky Notes & Geometric Shapes) */}
          {elements
            .filter((el) => el.type !== 'draw')
            .map((el) => {
              const isNote = el.type === 'sticky_note';
              const isRect = el.type === 'rectangle';
              const isCircle = el.type === 'circle';
              const isTri = el.type === 'triangle';
              const isSelected = selectedId === el.id;

              return (
                <div
                  key={el.id}
                  onClick={(e) => handleElementInteraction(el, e)}
                  onPointerDown={(e) => handleElementInteraction(el, e)}
                  style={{
                    position: 'absolute',
                    left: el.x,
                    top: el.y,
                    width: el.width,
                    height: el.height,
                    cursor:
                      activeTool === 'eraser'
                        ? 'pointer'
                        : activeTool === 'select'
                        ? 'move'
                        : 'default',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxSizing: 'border-box',
                    backgroundColor: isNote ? el.color : isRect ? '#eff6ff' : isCircle ? '#f0fdf4' : 'transparent',
                    border: isRect
                      ? '2px solid #60a5fa'
                      : isCircle
                      ? '2px solid #4ade80'
                      : isNote
                      ? '1px solid rgba(0,0,0,0.06)'
                      : 'none',
                    borderRadius: isCircle ? '50%' : isNote ? 4 : 8,
                    boxShadow: isNote
                      ? '0 10px 15px -3px rgba(0,0,0,0.08), 0 4px 6px -2px rgba(0,0,0,0.04)'
                      : 'none',
                    outline:
                      isSelected && activeTool === 'select'
                        ? '2px solid #2563eb'
                        : 'none',
                    outlineOffset: isTri ? '4px' : '2px',
                    padding: isNote ? '16px' : '0',
                    zIndex: 20
                  }}
                >
                  {/* Scaled Triangle Vector Graphic */}
                  {isTri && (
                    <svg
                      style={{
                        position: 'absolute',
                        width: '100%',
                        height: '100%',
                        top: 0,
                        left: 0,
                        pointerEvents: 'none'
                      }}
                      viewBox="0 0 100 100"
                      preserveAspectRatio="none"
                    >
                      <polygon
                        points="50,4 96,96 4,96"
                        fill="#fff1f2"
                        stroke="#fb7185"
                        strokeWidth="2.5"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}

                  {/* Strictly Padded & Contained Text Region */}
                  <div
                    onClick={(e) => {
                      if (activeTool === 'eraser') handleElementInteraction(el, e);
                    }}
                    style={{
                      width: isTri ? '50%' : isCircle ? '64%' : '90%',
                      height: isTri ? '36%' : isCircle ? '64%' : '88%',
                      marginTop: isTri ? '38%' : 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      zIndex: 30,
                      overflow: 'hidden'
                    }}
                  >
                    <textarea
                      value={el.text || ''}
                      spellCheck={false}
                      onChange={(e) => handleTextChange(el.id, e.target.value)}
                      onPointerDown={(e) => {
                        if (activeTool === 'select') e.stopPropagation();
                      }}
                      placeholder="Type..."
                      style={{
                        width: '100%',
                        height: '100%',
                        border: 'none',
                        background: 'transparent',
                        outline: 'none',
                        resize: 'none',
                        textAlign: isNote ? 'left' : 'center',
                        fontSize: isNote ? 14 : isTri ? 12 : 13,
                        fontWeight: 600,
                        color: isTri ? '#9f1239' : isCircle ? '#166534' : isRect ? '#1e40af' : '#1e293b',
                        lineHeight: 1.35,
                        fontFamily: 'inherit',
                        overflowWrap: 'break-word',
                        wordBreak: 'break-word',
                        whiteSpace: 'pre-wrap',
                        overflowY: 'hidden',
                        padding: 0,
                        margin: 0
                      }}
                    />
                  </div>

                  {/* Corner Resize Handle */}
                  {isSelected && activeTool === 'select' && (
                    <div
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        setResizingId(el.id);
                        setResizeData({
                          startX: e.clientX,
                          startY: e.clientY,
                          startW: el.width,
                          startH: el.height
                        });
                      }}
                      style={{
                        position: 'absolute',
                        right: -5,
                        bottom: -5,
                        width: 10,
                        height: 10,
                        backgroundColor: '#2563eb',
                        borderRadius: 2,
                        cursor: 'nwse-resize',
                        zIndex: 40,
                        border: '1.5px solid #ffffff',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.3)'
                      }}
                    />
                  )}
                </div>
              );
            })}

          {/* Peer Cursors */}
          {Object.entries(cursors).map(([id, cursor]) => (
            <div
              key={id}
              style={{
                position: 'absolute',
                left: cursor.x,
                top: cursor.y,
                pointerEvents: 'none',
                zIndex: 100,
                transition: 'left 35ms linear, top 35ms linear'
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill={cursor.color || '#2563eb'}>
                <path d="M3 3l7 18 3-7 7-3L3 3z" />
              </svg>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const btnPrimary = {
  color: '#ffffff',
  border: 'none',
  padding: '6px 14px',
  borderRadius: '8px',
  fontSize: '13px',
  fontWeight: '600',
  cursor: 'pointer',
  transition: 'background 0.15s ease',
  boxShadow: '0 1px 3px 0 rgba(16, 185, 129, 0.2)'
};

const btnSecondary = {
  background: '#ffffff',
  border: '1px solid #e2e8f0',
  padding: '4px 10px',
  borderRadius: '6px',
  fontSize: '12px',
  fontWeight: '600',
  color: '#475569',
  cursor: 'pointer'
};

const zoomActionBtn = {
  background: 'transparent',
  border: 'none',
  color: '#64748b',
  cursor: 'pointer',
  fontSize: '13px',
  fontWeight: 'bold',
  padding: '3px 6px',
  borderRadius: '4px'
};