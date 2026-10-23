import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export async function getStoredElements(boardId = 'room-alpha') {
  const { data, error } = await supabase
    .from('canvas_elements')
    .select('element_data')
    .eq('board_id', boardId);

  if (error) {
    console.error('Fetch error:', error.message);
    return [];
  }
  return data.map((row) => row.element_data);
}

export async function saveElementToDb(element, boardId = 'room-alpha') {
  if (!element?.id) return;
  const { error } = await supabase.from('canvas_elements').upsert({
    id: element.id,
    board_id: boardId,
    type: element.type || 'shape',
    element_data: element,
    updated_at: new Date().toISOString()
  });

  if (error) console.error('Upsert error:', error.message);
}

export async function deleteElementFromDb(elementId) {
  const { error } = await supabase
    .from('canvas_elements')
    .delete()
    .eq('id', elementId);

  if (error) console.error('Delete error:', error.message);
}

export async function clearBoardFromDb(boardId = 'room-alpha') {
  const { error } = await supabase
    .from('canvas_elements')
    .delete()
    .eq('board_id', boardId);

  if (error) console.error('Clear error:', error.message);
}
