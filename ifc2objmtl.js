const fs = require('fs');
const { IfcAPI } = require('web-ifc');

const scaleFactor = 50; // 放大 50 倍

function applyTransformation(matrix, x, y, z) {
  const xNew = (matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]) * scaleFactor;
  const yNew = (matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]) * scaleFactor;
  const zNew = (matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]) * scaleFactor;
  return [xNew, yNew, zNew];
}

function ifcGeometryToBuffer(color, vertexData, indexData, transform) {
  let posFloats = new Float32Array(vertexData.length / 2);
  let normFloats = new Float32Array(vertexData.length / 2);
  let colorFloats = new Float32Array(vertexData.length / 2);

  for (let i = 0; i < vertexData.length; i += 6) {
    const [x, y, z] = applyTransformation(transform, vertexData[i], vertexData[i + 1], vertexData[i + 2]);
    posFloats[i / 2 + 0] = x;
    posFloats[i / 2 + 1] = y;
    posFloats[i / 2 + 2] = z;

    const [nx, ny, nz] = applyTransformation(transform, vertexData[i + 3], vertexData[i + 4], vertexData[i + 5]);
    normFloats[i / 2 + 0] = nx;
    normFloats[i / 2 + 1] = ny;
    normFloats[i / 2 + 2] = nz;

    colorFloats[i / 2 + 0] = color.x;
    colorFloats[i / 2 + 1] = color.y;
    colorFloats[i / 2 + 2] = color.z;
  }

  return {
    posFloats,
    normFloats,
    colorFloats,
    color
  };
}

async function convertIfcToObj(ifcFilePath, outputFilePath) {
  const ifcapi = new IfcAPI();
  await ifcapi.Init();

  const ifcData = fs.readFileSync(ifcFilePath);
  const modelID = ifcapi.OpenModel(ifcData, { COORDINATE_TO_ORIGIN: true });

  let objContent = '';
  let mtlContent = '';
  let vertexOffset = 0;
  let materialCount = 0;
  let materials = {};

  ifcapi.StreamAllMeshes(modelID, (mesh, index) => {
    const placedGeometries = mesh.geometries;
    for (let i = 0; i < placedGeometries.size(); i++) {
      const placedGeometry = placedGeometries.get(i);
      const geometry = ifcapi.GetGeometry(modelID, placedGeometry.geometryExpressID);
      const verts = ifcapi.GetVertexArray(geometry.GetVertexData(), geometry.GetVertexDataSize());
      const indices = ifcapi.GetIndexArray(geometry.GetIndexData(), geometry.GetIndexDataSize());
      const bufferGeometry = ifcGeometryToBuffer(placedGeometry.color, verts, indices, placedGeometry.flatTransformation);

      if (verts.length === 0 || indices.length === 0) {
        continue;
      }

      const materialName = `material_${materialCount++}`;
      const color = bufferGeometry.color;

      mtlContent += `newmtl ${materialName}\n`;
      mtlContent += `Kd ${color.x} ${color.y} ${color.z}\n`;
      mtlContent += `d ${placedGeometry.color.w}\n\n`;

      objContent += `o mesh_${index}_${i}\n`;
      objContent += `usemtl ${materialName}\n`;

      const posFloats = bufferGeometry.posFloats;
      for (let j = 0; j < posFloats.length; j += 3) {
        objContent += `v ${posFloats[j]} ${posFloats[j + 1]} ${posFloats[j + 2]}\n`;
      }

      const normFloats = bufferGeometry.normFloats;
      for (let j = 0; j < normFloats.length; j += 3) {
        objContent += `vn ${normFloats[j]} ${normFloats[j + 1]} ${normFloats[j + 2]}\n`;
      }

      for (let j = 0; j < indices.length; j += 3) {
        objContent += `f ${indices[j] + 1 + vertexOffset} ${indices[j + 1] + 1 + vertexOffset} ${indices[j + 2] + 1 + vertexOffset}\n`;
      }

      vertexOffset += posFloats.length / 3;
      geometry.delete();
    }
  });

  const mtlFilePath = outputFilePath.replace('.obj', '.mtl');
  objContent = `mtllib ${mtlFilePath}\n` + objContent;

  fs.writeFileSync(outputFilePath, objContent, 'utf8');
  fs.writeFileSync(mtlFilePath, mtlContent, 'utf8');

  ifcapi.CloseModel(modelID);
}

convertIfcToObj('example.ifc', 'example.obj')
  .then(() => console.log('Conversion complete'))
  .catch(error => console.error('Conversion failed:', error));
